"""Small HTTP helpers shared by routers."""


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    """Compare an ETag against an `If-None-Match` header.

    The header may list several tags and may carry a weak `W/` prefix added
    by a proxy, so plain string equality would miss real matches and re-send
    the whole body for nothing.
    """
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    return any(tag.strip().removeprefix("W/") == etag for tag in if_none_match.split(","))
