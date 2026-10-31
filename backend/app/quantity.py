"""Sample quantity accounting.

Each Sample's own quantity ledger (sample_quantity_events) is the source of truth:

    available = starting quantity - removals from THIS sample + recorded increases

Removals are process/aliquot inputs ("consumed"), amounts taken when a child is created
("allocated"), and downward manual adjustments. What happens to a child afterwards is on the
child's ledger and never changes the parent. Every event stores the quantity before and after,
so the history must chain exactly from the starting quantity to samples.current_quantity;
when it does not, the result says so instead of reporting a percentage.
"""
from decimal import Decimal

# Units we can convert between, as (dimension, factor to the dimension's base unit).
_UNITS = {
    "l": ("volume", Decimal("1000000")), "ml": ("volume", Decimal("1000")), "ul": ("volume", Decimal("1")), "nl": ("volume", Decimal("0.001")),
    "g": ("mass", Decimal("1000000")), "mg": ("mass", Decimal("1000")), "ug": ("mass", Decimal("1")), "ng": ("mass", Decimal("0.001")), "pg": ("mass", Decimal("0.000001")),
}
_TOLERANCE = Decimal("0.000001")


def normalize_unit(unit: str | None) -> str | None:
    if unit is None or not unit.strip():
        return None
    return unit.strip().lower().replace("µ", "u").replace("μ", "u")


def unit_dimension(unit: str | None) -> str | None:
    known = _UNITS.get(normalize_unit(unit) or "")
    return known[0] if known else None


def convert(amount: Decimal | None, from_unit: str | None, to_unit: str | None) -> Decimal | None:
    """Convert between equal or compatible units; None when the units cannot be compared."""
    if amount is None:
        return None
    source, target = normalize_unit(from_unit), normalize_unit(to_unit)
    if source is None or target is None:
        return None
    if source == target:
        return amount
    if source in _UNITS and target in _UNITS and _UNITS[source][0] == _UNITS[target][0]:
        return amount * _UNITS[source][1] / _UNITS[target][1]
    return None


def availability(current_quantity: Decimal | None, quantity_unit: str | None, events: list) -> dict:
    """Summarize how much of a Sample remains from its SampleQuantityEvents, in the order they were recorded."""
    result = {
        "state": "tracked", "unit": quantity_unit, "dimension": unit_dimension(quantity_unit),
        "starting_quantity": None, "available_quantity": current_quantity, "removed_quantity": None,
        "added_quantity": None, "percent_remaining": None, "problems": [],
    }
    if current_quantity is None:
        return {**result, "state": "not_recorded"}
    if normalize_unit(quantity_unit) is None:
        return {**result, "state": "no_unit"}

    converted = []
    for event in events:
        values = [convert(value, event.quantity_unit, quantity_unit) if value is not None else None
                  for value in (event.quantity_change, event.quantity_before, event.quantity_after)]
        if values[0] is None:
            return {**result, "state": "unit_mismatch", "problems": [f"History recorded in {event.quantity_unit} cannot be compared with {quantity_unit}."]}
        converted.append((event, *values))

    starting = running = None
    removed = added = Decimal(0)
    problems: list[str] = []
    for event, change, before, after in converted:
        if before is None or after is None:
            # A quantity measured for the first time, or cleared to unknown, starts the accounting over.
            starting = running = after
            removed = added = Decimal(0)
            continue
        if running is None:
            starting = running = before
        elif abs(before - running) > _TOLERANCE:
            problems.append(f"History jumps from {_plain(running)} to {_plain(before)} {quantity_unit} on {_date(event.event_date)} without a recorded change.")
        if abs((after - before) - change) > _TOLERANCE:
            problems.append(f"The change recorded on {_date(event.event_date)} ({_plain(change)}) does not equal after minus before ({_plain(after - before)}).")
        delta = after - before
        if delta < 0:
            removed -= delta
        else:
            added += delta
        running = after

    if starting is None:
        starting = running = current_quantity
    if abs(running - current_quantity) > _TOLERANCE:
        problems.append(f"The recorded quantity ({_plain(current_quantity)} {quantity_unit}) does not match its history ({_plain(running)} {quantity_unit}).")
    if current_quantity < 0:
        problems.append(f"The recorded quantity is negative ({_plain(current_quantity)} {quantity_unit}).")

    result.update(starting_quantity=starting, removed_quantity=removed, added_quantity=added)
    if problems:
        return {**result, "state": "inconsistent", "problems": problems}
    if starting > 0:
        result["percent_remaining"] = float(round(current_quantity / starting * 100, 1))
    return result


def _plain(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _date(value) -> str:
    return value.strftime("%Y-%m-%d") if hasattr(value, "strftime") else str(value)
