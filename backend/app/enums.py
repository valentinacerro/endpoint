"""Stable keys.

Project rule: the database always stores these English keys, never a translated
label. Translations live only in the frontend (`i18n/locales/*.ts`).

Why: the previous version of this app stored "Hotel"/"Volo" in Italian and
compared against those strings. Once other languages arrived the data became
inconsistent and needed a migration. Adding a language must cost the backend
nothing.
"""

from enum import StrEnum


class TripStatus(StrEnum):
    PLANNED = "planned"
    ACTIVE = "active"
    DONE = "done"
    ARCHIVED = "archived"


class BookingKind(StrEnum):
    HOTEL = "hotel"
    FLIGHT = "flight"
    TRAIN = "train"
    BUS = "bus"
    FERRY = "ferry"
    CAR_RENTAL = "car_rental"
    ACTIVITY = "activity"
    RESTAURANT = "restaurant"
    OTHER = "other"


class BookingStatus(StrEnum):
    CONFIRMED = "confirmed"
    PENDING = "pending"
    CANCELLED = "cancelled"


class PlaceCategory(StrEnum):
    """What kind of thing a candidate place is.

    `FOOD` earns its own key rather than sitting under OTHER: the itinerary
    optimiser needs to recognise somewhere to eat in order to place a lunch
    break near wherever you happen to be at midday.
    """

    SIGHT = "sight"
    MUSEUM = "museum"
    TEMPLE = "temple"
    SHRINE = "shrine"
    PARK = "park"
    GARDEN = "garden"
    SHOPPING = "shopping"
    FOOD = "food"
    VIEWPOINT = "viewpoint"
    EXPERIENCE = "experience"
    OTHER = "other"


class WeatherExposure(StrEnum):
    """How much a place suffers from bad weather.

    What the rain re-balancer swaps on: when a downpour is forecast, outdoor
    stops trade places with indoor ones from another day. Stored per place
    rather than inferred at the time, because the exceptions are what matter —
    a covered market is `shopping` but sheltered, an "indoor" museum may have
    a garden you actually came for.
    """

    INDOOR = "indoor"
    OUTDOOR = "outdoor"
    MIXED = "mixed"


class Priority(StrEnum):
    """How badly you want to see a place.

    Used when a day overflows: the optimiser pushes the low-priority stops to
    another day rather than making you run.
    """

    MUST_SEE = "must_see"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class ChecklistCategory(StrEnum):
    DOCUMENTS = "documents"
    CLOTHES = "clothes"
    ELECTRONICS = "electronics"
    TOILETRIES = "toiletries"
    HEALTH = "health"
    OTHER = "other"


class ExpenseCategory(StrEnum):
    FOOD = "food"
    TRANSPORT = "transport"
    LODGING = "lodging"
    TICKETS = "tickets"
    SHOPPING = "shopping"
    GIFTS = "gifts"
    FEES = "fees"
    OTHER = "other"


class PaymentMethod(StrEnum):
    """Worth tracking in Japan, where cash is still very much alive and the
    two come out of different pockets."""

    CASH = "cash"
    CARD = "card"


class RateSource(StrEnum):
    """Where a conversion rate came from.

    `ECB` is the reference rate, which is *not* what a card charges — banks
    add a spread. Recording the source is what lets a rate be replaced later
    with the real one off a statement.
    """

    ECB = "ecb"
    MANUAL = "manual"


class TimeSource(StrEnum):
    """How confidently we know when a photo was taken.

    EXIF records the local wall clock and, only since 2016 and only on
    some cameras, the offset it belonged to. Without that offset the
    instant has to be inferred from where the photo was taken, which is a
    good guess and not a fact — so the difference is recorded rather than
    smoothed over.
    """

    EXIF = "exif"
    ASSUMED = "assumed"


class AttachmentKind(StrEnum):
    VOUCHER = "voucher"
    TICKET = "ticket"
    PASSPORT = "passport"
    INSURANCE = "insurance"
    MAP = "map"
    RECEIPT = "receipt"
    OTHER = "other"


class TimePrecision(StrEnum):
    """Tells "flight at 09:35" apart from "hotel, 12th to 15th April"."""

    DATETIME = "datetime"
    DATE = "date"


class StorageBackend(StrEnum):
    """Where an attachment's bytes live.

    Today only `db` (bytea on Neon). The column exists from day one so that
    moving to object storage later is a new class, not a rewrite.
    """

    DB = "db"
    S3 = "s3"


def values(enum_cls: type[StrEnum]) -> list[str]:
    """Every value of an enum, for the CheckConstraints in the models."""
    return [member.value for member in enum_cls]


#: Starting point for a place's weather exposure, used when the client does
#: not state one. Only a default — the whole reason the field is stored rather
#: than computed is that the exceptions are what matter.
DEFAULT_EXPOSURE: dict[PlaceCategory, WeatherExposure] = {
    PlaceCategory.MUSEUM: WeatherExposure.INDOOR,
    PlaceCategory.SHOPPING: WeatherExposure.INDOOR,
    PlaceCategory.PARK: WeatherExposure.OUTDOOR,
    PlaceCategory.GARDEN: WeatherExposure.OUTDOOR,
    PlaceCategory.VIEWPOINT: WeatherExposure.OUTDOOR,
    # Visiting a Japanese temple or shrine means walking the grounds, so rain
    # spoils it much the same way it spoils a park.
    PlaceCategory.TEMPLE: WeatherExposure.OUTDOOR,
    PlaceCategory.SHRINE: WeatherExposure.OUTDOOR,
}


def default_exposure(category: PlaceCategory) -> WeatherExposure:
    return DEFAULT_EXPOSURE.get(category, WeatherExposure.MIXED)
