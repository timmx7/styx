"""Model pricing API — public endpoint for AI model pricing."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.schemas_billing import ModelPricingResponse
from app.services.pricing_service import get_all_active_pricing

router = APIRouter(prefix="/pricing", tags=["pricing"])


@router.get("/models", response_model=list[ModelPricingResponse])
async def list_model_pricing(
    db: AsyncSession = Depends(get_db),
) -> list[ModelPricingResponse]:
    """List all active AI model pricing (public endpoint)."""
    models = await get_all_active_pricing(db)
    return [ModelPricingResponse.model_validate(m) for m in models]
