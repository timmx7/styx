"""Prompt Playground API endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.db.database import get_db
from app.deps import get_current_user, require_project_access
from app.models.prompt import PromptTemplate
from app.models.user import User
from app.schemas import PromptCreate, PromptUpdate, PromptResponse

router = APIRouter(prefix="/projects/{project_id}/prompts", tags=["prompts"])


@router.post("", response_model=PromptResponse, status_code=status.HTTP_201_CREATED)
async def create_prompt_template(
    project_id: uuid.UUID,
    data: PromptCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PromptTemplate:
    """Create a new prompt template for a project."""
    await require_project_access(db, str(project_id), current_user.id, min_role="admin")

    # If this is active, deactivate all other prompts in this project
    if data.is_active:
        await _deactivate_other_prompts(db, project_id)

    prompt = PromptTemplate(
        project_id=project_id,
        name=data.name,
        system_prompt=data.system_prompt,
        is_active=data.is_active,
    )
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.get("", response_model=list[PromptResponse])
async def list_prompts(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PromptTemplate]:
    """List all prompt templates for a project."""
    await require_project_access(db, str(project_id), current_user.id, min_role="viewer")

    query = select(PromptTemplate).where(PromptTemplate.project_id == project_id).order_by(PromptTemplate.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


@router.put("/{prompt_id}", response_model=PromptResponse)
async def update_prompt_template(
    project_id: uuid.UUID,
    prompt_id: uuid.UUID,
    data: PromptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PromptTemplate:
    """Update a prompt template."""
    await require_project_access(db, str(project_id), current_user.id, min_role="admin")

    prompt = await _get_prompt_or_404(db, project_id, prompt_id)

    # If setting to active, deactivate all other prompts
    if data.is_active is True and not prompt.is_active:
        await _deactivate_other_prompts(db, project_id)

    if data.name is not None:
        prompt.name = data.name
    if data.system_prompt is not None:
        prompt.system_prompt = data.system_prompt
    if data.is_active is not None:
        prompt.is_active = data.is_active

    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt_template(
    project_id: uuid.UUID,
    prompt_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a prompt template."""
    await require_project_access(db, str(project_id), current_user.id, min_role="admin")

    prompt = await _get_prompt_or_404(db, project_id, prompt_id)
    await db.delete(prompt)
    await db.commit()


# --- Helpers ---

async def _get_prompt_or_404(db: AsyncSession, project_id: uuid.UUID, prompt_id: uuid.UUID) -> PromptTemplate:
    query = select(PromptTemplate).where(
        PromptTemplate.project_id == project_id,
        PromptTemplate.id == prompt_id
    )
    result = await db.execute(query)
    prompt = result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt not found"
        )
    return prompt


async def _deactivate_other_prompts(db: AsyncSession, project_id: uuid.UUID) -> None:
    from sqlalchemy import update
    await db.execute(
        update(PromptTemplate)
        .where(PromptTemplate.project_id == project_id)
        .values(is_active=False)
    )
