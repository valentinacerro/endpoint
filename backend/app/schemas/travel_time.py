import uuid

from pydantic import BaseModel, Field

from app.schemas.common import WriteModel


class TravelTimeWrite(WriteModel):
    from_lat: float = Field(ge=-90, le=90)
    from_lon: float = Field(ge=-180, le=180)
    to_lat: float = Field(ge=-90, le=90)
    to_lon: float = Field(ge=-180, le=180)
    #: Zero means "no time at all", which is a legitimate correction for two
    #: things in the same building. The upper bound is a day, past which the
    #: number is a typo rather than a journey.
    minutes: int = Field(ge=0, le=1440)


class TravelTimeRead(BaseModel):
    id: uuid.UUID
    from_lat: float
    from_lon: float
    to_lat: float
    to_lon: float
    minutes: int

    model_config = {"from_attributes": True}
