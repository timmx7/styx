"""Team management endpoints: members, invitations, roles.

Endpoints:
  POST   /teams/{team_id}/invite          → Invite a user by email
  GET    /teams/{team_id}/invitations      → List pending invitations
  DELETE /teams/{team_id}/invitations/{id} → Cancel an invitation
  POST   /teams/accept-invite             → Accept an invitation (via token)
  POST   /teams/decline-invite            → Decline an invitation (via token)
  GET    /teams/{team_id}/members          → List team members
  PUT    /teams/{team_id}/members/{id}     → Update a member's role
  DELETE /teams/{team_id}/members/{id}     → Remove a member (or leave)

Access control:
  - owner  → everything
  - admin  → invite, list, remove members, cancel invitations
  - member → list members, leave team
"""

import logging
from datetime import datetime, timedelta, timezone

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.database import get_db
from app.deps import get_current_user, get_team_membership, require_team_membership
from app.models.team import Team
from app.models.team_member import TeamMember
from app.models.team_invitation import TeamInvitation
from app.models.user import User
from app.models.sso import IdentityProvider
from app.schemas import (
    AcceptInvitationRequest,
    InviteToTeamRequest,
    MessageResponse,
    TeamInvitationResponse,
    TeamMemberResponse,
    UpdateMemberRoleRequest,
    IdentityProviderResponse,
    IdentityProviderUpdate,
)
from app.services.audit_service import log as audit_log
from app.services.email_service import send_team_invitation_email
from app.services.token_service import generate_token, hash_token

logger = logging.getLogger("teams")

router = APIRouter(prefix="/teams", tags=["teams"])


# ─── Helpers ──────────────────────────────────────────────────────────

VALID_ROLES = {"owner", "admin", "developer", "viewer", "billing", "member"}
INVITE_ROLES = {"admin", "developer", "viewer", "billing", "member"}  # Can't invite as owner


# _get_membership and _require_membership are now shared via deps.py
# Aliases kept for local readability
_get_membership = get_team_membership
_require_membership = require_team_membership


def _member_to_response(member: TeamMember) -> dict:
    """Convert a TeamMember + loaded user to a response dict."""
    return {
        "id": member.id,
        "team_id": member.team_id,
        "user_id": member.user_id,
        "role": member.role,
        "user_email": member.user.email if member.user else None,
        "user_name": member.user.name if member.user else None,
        "created_at": member.created_at,
    }


# ─── Invite a user to the team ───────────────────────────────────────

@router.post("/{team_id}/invite", response_model=TeamInvitationResponse, status_code=201)
async def invite_to_team(
    team_id: str,
    body: InviteToTeamRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Invite a user to the team by email. Requires admin+ role."""
    await _require_membership(db, team_id, current_user.id, min_role="admin")

    # Check if user is already a member
    result = await db.execute(
        select(User).where(User.email == body.email)
    )
    existing_user = result.scalar_one_or_none()

    if existing_user:
        existing_member = await _get_membership(db, team_id, existing_user.id)
        if existing_member is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a member of this team",
            )

    # Check for an existing pending invitation for this email+team
    result = await db.execute(
        select(TeamInvitation).where(
            and_(
                TeamInvitation.team_id == team_id,
                TeamInvitation.invited_email == body.email,
                TeamInvitation.status == "pending",
            )
        )
    )
    existing_invite = result.scalar_one_or_none()
    if existing_invite is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending invitation already exists for this email",
        )

    # Create the invitation
    plain_token = generate_token()
    token_hash_value = hash_token(plain_token)
    expires_at = datetime.now(timezone.utc) + timedelta(
        days=settings.team_invitation_expire_days
    )

    invitation = TeamInvitation(
        team_id=team_id,
        invited_email=body.email,
        role=body.role,
        token_hash=token_hash_value,
        status="pending",
        invited_by_id=current_user.id,
        expires_at=expires_at,
    )
    db.add(invitation)
    await db.flush()

    # Load the team name for the email
    team_result = await db.execute(select(Team).where(Team.id == team_id))
    team = team_result.scalar_one_or_none()
    team_name = team.name if team else "Unknown Team"

    # Send invitation email (fire-and-forget)
    try:
        await send_team_invitation_email(
            to_email=body.email,
            token=plain_token,
            team_name=team_name,
            role=body.role,
            inviter_name=current_user.name,
        )
    except Exception:
        logger.exception("Failed to send invitation email to %s", body.email)

    await audit_log(
        db, action="team_member.invite", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="team_invitation",
        resource_id=str(invitation.id), team_id=team_id,
        details=json.dumps({"invited_email": body.email, "role": body.role}),
        request=request,
    )

    return invitation


# ─── List pending invitations for a team ──────────────────────────────

@router.get("/{team_id}/invitations", response_model=list[TeamInvitationResponse])
async def list_invitations(
    team_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all pending invitations. Requires admin+ role."""
    await _require_membership(db, team_id, current_user.id, min_role="admin")

    result = await db.execute(
        select(TeamInvitation).where(
            and_(
                TeamInvitation.team_id == team_id,
                TeamInvitation.status == "pending",
            )
        ).limit(limit).offset(offset)
    )
    return list(result.scalars().all())


# ─── Cancel an invitation ────────────────────────────────────────────

@router.delete("/{team_id}/invitations/{invitation_id}", response_model=MessageResponse)
async def cancel_invitation(
    team_id: str,
    invitation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a pending invitation. Requires admin+ role."""
    await _require_membership(db, team_id, current_user.id, min_role="admin")

    result = await db.execute(
        select(TeamInvitation).where(
            and_(
                TeamInvitation.id == invitation_id,
                TeamInvitation.team_id == team_id,
                TeamInvitation.status == "pending",
            )
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found or already processed",
        )

    invitation.status = "cancelled"
    await db.flush()
    return MessageResponse(message="Invitation cancelled")


# ─── Accept an invitation (via token) ────────────────────────────────

@router.post("/accept-invite", response_model=TeamMemberResponse)
async def accept_invitation(
    body: AcceptInvitationRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Accept a team invitation using the token from the email.

    The current user must be logged in. The invitation email doesn't need
    to match the user's email — this allows accepting from a different email
    (e.g. personal invited, logs in with work account).
    """
    token_hash_value = hash_token(body.token)

    result = await db.execute(
        select(TeamInvitation).where(
            and_(
                TeamInvitation.token_hash == token_hash_value,
                TeamInvitation.status == "pending",
                TeamInvitation.expires_at > datetime.now(timezone.utc),
            )
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired invitation token",
        )

    # Check if user is already a member
    existing_member = await _get_membership(db, invitation.team_id, current_user.id)
    if existing_member is not None:
        # Mark invitation as accepted anyway (idempotent)
        invitation.status = "accepted"
        await db.flush()
        return _member_to_response(existing_member)

    # Create the membership
    member = TeamMember(
        team_id=invitation.team_id,
        user_id=current_user.id,
        role=invitation.role,
    )
    db.add(member)
    invitation.status = "accepted"
    await db.flush()

    # Reload with user relationship
    result = await db.execute(
        select(TeamMember).where(TeamMember.id == member.id)
    )
    member = result.scalar_one()

    await audit_log(
        db, action="team_member.accept_invite", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="team_member",
        resource_id=str(member.id), team_id=str(invitation.team_id),
        details=json.dumps({"role": invitation.role}), request=request,
    )

    return _member_to_response(member)


# ─── Decline an invitation (via token) ───────────────────────────────

@router.post("/decline-invite", response_model=MessageResponse)
async def decline_invitation(
    body: AcceptInvitationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Decline a team invitation using the token from the email."""
    token_hash_value = hash_token(body.token)

    result = await db.execute(
        select(TeamInvitation).where(
            and_(
                TeamInvitation.token_hash == token_hash_value,
                TeamInvitation.status == "pending",
            )
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or already processed invitation",
        )

    invitation.status = "declined"
    await db.flush()
    return MessageResponse(message="Invitation declined")


# ─── List team members ───────────────────────────────────────────────

@router.get("/{team_id}/members", response_model=list[TeamMemberResponse])
async def list_members(
    team_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all members of a team. Requires member+ role."""
    await _require_membership(db, team_id, current_user.id, min_role="member")

    result = await db.execute(
        select(TeamMember).where(TeamMember.team_id == team_id)
        .limit(limit).offset(offset)
    )
    members = result.scalars().all()
    return [_member_to_response(m) for m in members]


# ─── Update a member's role ──────────────────────────────────────────

@router.put("/{team_id}/members/{member_id}", response_model=TeamMemberResponse)
async def update_member_role(
    team_id: str,
    member_id: str,
    body: UpdateMemberRoleRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change a team member's role. Only owner can do this."""
    await _require_membership(db, team_id, current_user.id, min_role="owner")

    result = await db.execute(
        select(TeamMember).where(
            and_(
                TeamMember.id == member_id,
                TeamMember.team_id == team_id,
            )
        )
    )
    target = result.scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    if target.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change the owner's role",
        )

    old_role = target.role
    target.role = body.role
    await db.flush()

    await audit_log(
        db, action="team_member.role_update", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="team_member",
        resource_id=member_id, team_id=team_id,
        details=json.dumps({"old_role": old_role, "new_role": body.role}),
        request=request,
    )

    # Reload for response
    result = await db.execute(
        select(TeamMember).where(TeamMember.id == target.id)
    )
    target = result.scalar_one()
    return _member_to_response(target)


# ─── Remove a member (or leave the team) ─────────────────────────────

@router.delete("/{team_id}/members/{member_id}", response_model=MessageResponse)
async def remove_member(
    team_id: str,
    member_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from the team, or leave the team yourself.

    Rules:
      - Owner can remove anyone except themselves
      - Admin can remove members (not other admins or owner)
      - Any member can leave (remove themselves) — except the owner
    """
    my_membership = await _require_membership(db, team_id, current_user.id, min_role="member")

    result = await db.execute(
        select(TeamMember).where(
            and_(
                TeamMember.id == member_id,
                TeamMember.team_id == team_id,
            )
        )
    )
    target = result.scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    # Owner cannot be removed
    if target.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove the team owner",
        )

    is_self = target.user_id == current_user.id
    hierarchy = {"owner": 5, "admin": 4, "developer": 3, "billing": 2, "viewer": 1, "member": 3}

    if not is_self:
        # Must have higher role than target
        if hierarchy.get(my_membership.role, 0) <= hierarchy.get(target.role, 0):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to remove this member",
            )

    target_user_id = str(target.user_id)
    await db.delete(target)
    await db.flush()

    action_type = "team_member.leave" if is_self else "team_member.remove"
    await audit_log(
        db, action=action_type, actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="team_member",
        resource_id=member_id, team_id=team_id,
        details=json.dumps({"removed_user_id": target_user_id}),
        request=request,
    )

    action = "You have left the team" if is_self else "Member removed"
    return MessageResponse(message=action)


# ─── SSO Configuration ────────────────────────────────────────────────

@router.get("/{team_id}/sso", response_model=IdentityProviderResponse)
async def get_sso_config(
    team_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the SSO identity provider configuration for the team. Requires admin+ role."""
    await _require_membership(db, team_id, current_user.id, min_role="admin")

    result = await db.execute(
        select(IdentityProvider).where(IdentityProvider.team_id == team_id)
    )
    idp = result.scalar_one_or_none()
    if not idp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SSO configuration not found for this team"
        )
    return idp


@router.put("/{team_id}/sso", response_model=IdentityProviderResponse)
async def update_sso_config(
    team_id: str,
    body: IdentityProviderUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create or update the SSO identity provider configuration. Requires admin+ role.
    Note: A team can only have one identity provider.
    """
    await _require_membership(db, team_id, current_user.id, min_role="admin")

    # Domain MUST be unique globally if provided
    if body.domain:
        result = await db.execute(
            select(IdentityProvider).where(
                and_(
                    IdentityProvider.domain == body.domain,
                    IdentityProvider.team_id != team_id
                )
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This domain is already registered for SSO by another team"
            )

    result = await db.execute(
        select(IdentityProvider).where(IdentityProvider.team_id == team_id)
    )
    idp = result.scalar_one_or_none()

    if idp:
        # Update existing
        if body.provider_type is not None:
            idp.provider_type = body.provider_type
        if body.domain is not None:
            idp.domain = body.domain
        if body.config is not None:
            idp.config = body.config
        if body.is_active is not None:
            idp.is_active = body.is_active
        idp.updated_at = datetime.now(timezone.utc)
        action_type = "team_sso.update"
    else:
        # Create new
        if not body.domain:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Domain is required to create SSO configuration"
            )
        
        idp = IdentityProvider(
            team_id=team_id,
            provider_type=body.provider_type or "saml",
            domain=body.domain,
            config=body.config or {},
            is_active=body.is_active if body.is_active is not None else True
        )
        db.add(idp)
        action_type = "team_sso.create"

    await db.flush()

    await audit_log(
        db, action=action_type, actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="team",
        resource_id=team_id, team_id=team_id,
        details=json.dumps({"domain": idp.domain, "provider_type": idp.provider_type}),
        request=request,
    )
    await db.refresh(idp)
    return idp


@router.delete("/{team_id}/sso", response_model=MessageResponse)
async def delete_sso_config(
    team_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete the SSO identity provider configuration. Requires admin+ role."""
    await _require_membership(db, team_id, current_user.id, min_role="admin")

    result = await db.execute(
        select(IdentityProvider).where(IdentityProvider.team_id == team_id)
    )
    idp = result.scalar_one_or_none()
    if not idp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SSO configuration not found for this team"
        )

    await db.delete(idp)
    await db.flush()

    await audit_log(
        db, action="team_sso.delete", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="team",
        resource_id=team_id, team_id=team_id,
        details=json.dumps({"domain": idp.domain}),
        request=request,
    )

    return MessageResponse(message="SSO configuration deleted")
