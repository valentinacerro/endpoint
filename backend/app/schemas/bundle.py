import datetime as dt

from pydantic import BaseModel, ConfigDict

from app.schemas.attachment import AttachmentRead
from app.schemas.booking import BookingRead
from app.schemas.checklist import ChecklistItemRead
from app.schemas.day_note import DayNoteRead
from app.schemas.diary import DiaryEntryRead
from app.schemas.expense import ExpenseRead
from app.schemas.memory import MemoryRead
from app.schemas.place import PlaceRead
from app.schemas.stop import StopRead
from app.schemas.travel_time import TravelTimeRead
from app.schemas.trip import TripRead


class TripBundle(BaseModel):
    """Everything the app needs about one trip, in a single response.

    This is the keystone of the offline design. Against a service that can
    take a minute to wake up, doing N+1 requests to paint a screen is not an
    option: one request, one cache entry, one trip through the cold start.
    """

    model_config = ConfigDict(from_attributes=True)

    trip: TripRead
    stops: list[StopRead]
    bookings: list[BookingRead]
    places: list[PlaceRead]
    checklist: list[ChecklistItemRead]
    expenses: list[ExpenseRead]
    day_notes: list[DayNoteRead]
    diary: list[DiaryEntryRead]
    memories: list[MemoryRead]
    travel_times: list[TravelTimeRead]
    attachments: list[AttachmentRead]
    generated_at: dt.datetime
