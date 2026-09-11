"""Domain models.

Every model must be re-exported here: Alembic imports this module to populate
`Base.metadata`, and a model that is not imported simply does not exist as far
as migration autogeneration is concerned — it would silently vanish from the
database schema.
"""

from app.models.attachment import Attachment, AttachmentBlob
from app.models.booking import Booking
from app.models.checklist import ChecklistItem
from app.models.day_note import DayNote
from app.models.diary import DiaryEntry
from app.models.expense import Expense
from app.models.place import Place
from app.models.stop import Stop
from app.models.trip import Trip

__all__ = [
    "Attachment",
    "AttachmentBlob",
    "Booking",
    "ChecklistItem",
    "DayNote",
    "DiaryEntry",
    "Expense",
    "Place",
    "Stop",
    "Trip",
]
