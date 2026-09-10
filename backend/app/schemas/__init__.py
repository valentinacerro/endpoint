"""Request and response shapes.

Deliberately separate from the SQLAlchemy models. Each entity needs four
different shapes anyway — Create, Update, Read and its slice of the offline
bundle — and the attachment bytes must never be able to appear in a response
at all, which is far easier to guarantee when the field simply does not exist
on the schema.
"""
