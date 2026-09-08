"""The fixed vocabulary of player positions, ported from the Worker's positions.ts.

Positions are stored as a code and displayed as a name. The API accepts only the
codes; ``code_for_free_text`` exists solely so the data migration (and any client
still sending prose) has a way across.
"""

from typing import Literal

PositionLine = Literal["GK", "DEF", "MID", "FWD"]

# (code, name, line) — the full eleven-a-side vocabulary; small-sided squads use
# the part of it that describes where someone actually plays.
POSITIONS: list[tuple[str, str, PositionLine]] = [
    ("GK", "Goalkeeper", "GK"),
    ("CB", "Centre-back", "DEF"),
    ("LB", "Left-back", "DEF"),
    ("RB", "Right-back", "DEF"),
    ("LWB", "Left wing-back", "DEF"),
    ("RWB", "Right wing-back", "DEF"),
    ("DM", "Defensive midfield", "MID"),
    ("CM", "Centre midfield", "MID"),
    ("AM", "Attacking midfield", "MID"),
    ("LM", "Left midfield", "MID"),
    ("RM", "Right midfield", "MID"),
    ("LW", "Left wing", "FWD"),
    ("RW", "Right wing", "FWD"),
    ("SS", "Second striker", "FWD"),
    ("CF", "Centre-forward", "FWD"),
    ("ST", "Striker", "FWD"),
]

# The goalkeeper's code, named so the goalkeeping walk reads by intent rather
# than a bare string literal.
GOALKEEPER = "GK"

POSITION_CODES: frozenset[str] = frozenset(code for code, _, _ in POSITIONS)
_BY_NAME_LOOSE = {
    name.lower().replace("-", "").replace(" ", ""): code for code, name, _ in POSITIONS
}


def code_for_free_text(value: str | None) -> str:
    """The closest code to a position written as free text. Where the text only
    identifies a line, the most central position on that line is taken."""
    text = (value or "").strip().lower()
    if not text:
        return "CM"
    upper = (value or "").strip().upper()
    if upper in POSITION_CODES:
        return upper
    loose = text.replace("-", "").replace(" ", "")
    if loose in _BY_NAME_LOOSE:
        return _BY_NAME_LOOSE[loose]
    if text.startswith("goal") or "keeper" in text:
        return "GK"
    # Wing-back before wing: the flank word is in both, only one is a defender.
    if "wing-back" in text or "wing back" in text:
        return "LWB" if text.startswith("l") else "RWB"
    # Midfield before the lines either side of it: "defensive midfielder" is a
    # midfielder, not a defender.
    if "mid" in text:
        return "CM"
    if text.startswith("def") or "back" in text:
        return "CB"
    if any(word in text for word in ("forward", "strik", "wing", "attack")):
        return "ST"
    return "CM"
