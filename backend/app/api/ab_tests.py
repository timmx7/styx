import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user, require_project_access
from app.models.ab_test import ABTestExperiment
from app.models.user import User
from app.schemas import (
    ABTestExperimentCreate,
    ABTestExperimentResponse,
    ABTestExperimentUpdate,
)

router = APIRouter(prefix="/projects/{project_id}/ab-tests", tags=["AB Testing Evals"])


@router.get("", response_model=list[ABTestExperimentResponse])
async def list_ab_tests(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """List all A/B testing experiments for a project.

    Requires at least 'viewer' role on the project.
    """
    await require_project_access(db, project_id, current_user.id, min_role="viewer")

    stmt = select(ABTestExperiment).where(ABTestExperiment.project_id == project_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=ABTestExperimentResponse, status_code=status.HTTP_201_CREATED)
async def create_ab_test(
    project_id: str,
    experiment_in: ABTestExperimentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Create a new A/B testing experiment for a project.

    Requires at least 'developer' role on the project.
    """
    await require_project_access(db, project_id, current_user.id, min_role="developer")

    # Calculate total weight
    total_weight = sum(variant.weight for variant in experiment_in.variants)
    if experiment_in.variants and total_weight != 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Total weight of variants must be 100, got {total_weight}",
        )

    # Disable other active experiments if this one is active (only 1 active at a time)
    if experiment_in.is_active:
        stmt = select(ABTestExperiment).where(ABTestExperiment.project_id == project_id).where(ABTestExperiment.is_active)
        active_experiments = (await db.execute(stmt)).scalars().all()
        for exp in active_experiments:
            exp.is_active = False

    experiment = ABTestExperiment(
        project_id=uuid.UUID(project_id),
        name=experiment_in.name,
        is_active=experiment_in.is_active,
        variants=[v.model_dump() for v in experiment_in.variants],
    )
    db.add(experiment)
    await db.commit()
    await db.refresh(experiment)
    
    return experiment


@router.put("/{experiment_id}", response_model=ABTestExperimentResponse)
async def update_ab_test(
    project_id: str,
    experiment_id: str,
    experiment_in: ABTestExperimentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Update an A/B testing experiment.

    Requires at least 'developer' role on the project.
    """
    await require_project_access(db, project_id, current_user.id, min_role="developer")

    stmt = select(ABTestExperiment).where(
        ABTestExperiment.id == experiment_id, 
        ABTestExperiment.project_id == project_id
    )
    experiment = (await db.execute(stmt)).scalar_one_or_none()
    
    if not experiment:
        raise HTTPException(status_code=404, detail="A/B Test Experiment not found")

    if experiment_in.variants is not None:
        total_weight = sum(variant.weight for variant in experiment_in.variants)
        if total_weight != 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Total weight of variants must be 100, got {total_weight}",
            )
        experiment.variants = [v.model_dump() for v in experiment_in.variants]

    if experiment_in.name is not None:
        experiment.name = experiment_in.name

    if experiment_in.is_active is not None:
        # If activating this one, deactivate others
        if experiment_in.is_active and not experiment.is_active:
            stmt_active = select(ABTestExperiment).where(
                ABTestExperiment.project_id == project_id, 
                ABTestExperiment.is_active
            )
            active_experiments = (await db.execute(stmt_active)).scalars().all()
            for active_exp in active_experiments:
                active_exp.is_active = False
        experiment.is_active = experiment_in.is_active

    await db.commit()
    await db.refresh(experiment)
    
    return experiment


@router.delete("/{experiment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ab_test(
    project_id: str,
    experiment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an A/B testing experiment.

    Requires at least 'developer' role on the project.
    """
    await require_project_access(db, project_id, current_user.id, min_role="developer")

    stmt = select(ABTestExperiment).where(
        ABTestExperiment.id == experiment_id, 
        ABTestExperiment.project_id == project_id
    )
    experiment = (await db.execute(stmt)).scalar_one_or_none()
    
    if not experiment:
        raise HTTPException(status_code=404, detail="A/B Test Experiment not found")

    await db.delete(experiment)
    await db.commit()
