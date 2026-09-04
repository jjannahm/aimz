"""The arithmetic of a knockout's shape, kept clear of the request layer.

Ported from the Worker's knockout-shape.ts so the bracket sizes and validation
match exactly.
"""

from dataclasses import dataclass

# Presets offered in the UI; any other whole shape is accepted too.
TEAM_COUNTS = (8, 16, 32)
# What a group held before it could be told otherwise.
GROUP_SIZE = 4
# Two from each group go through, which settles the bracket's size.
ADVANCE_PER_GROUP = 2


def group_count_for(team_count: int, group_size: int = GROUP_SIZE) -> int:
    return team_count // group_size


def is_power_of_two(value: int) -> bool:
    return isinstance(value, int) and value >= 1 and (value & (value - 1)) == 0


def rounds_for(group_count: int) -> list[int]:
    """Rounds a knockout runs, biggest first, named by how many teams are left."""
    rounds: list[int] = []
    rnd = group_count * ADVANCE_PER_GROUP
    while rnd >= 2:
        rounds.append(rnd)
        rnd //= 2
    return rounds


def round_label(round_size: int) -> str:
    if round_size == 2:
        return "Final"
    if round_size == 4:
        return "Semi Finals"
    if round_size == 8:
        return "Quarter Finals"
    return f"Round of {round_size}"


@dataclass
class Shape:
    team_count: int | None
    group_size: int | None


class ShapeError(ValueError):
    """A shape that does not divide into a clean bracket."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


def resolve_shape(team_count: int | None, raw_group_size: int | None) -> Shape:
    """The shape a knockout is drawn in, or a ShapeError naming the bad field.

    Both null together for a competition that is only a table. A shape holds when
    it divides into whole groups of at least two and the teams coming out fill a
    bracket exactly — i.e. when the group count is a power of two.
    """
    if team_count is None:
        return Shape(team_count=None, group_size=None)
    if not isinstance(team_count, int) or isinstance(team_count, bool) or team_count < 4:
        raise ShapeError("team_count", "Must be a whole number of teams.")
    group_size = GROUP_SIZE if raw_group_size is None else raw_group_size
    if not isinstance(group_size, int) or isinstance(group_size, bool) or group_size < 2:
        raise ShapeError("group_size", "A group holds at least two teams.")
    if team_count % group_size != 0:
        raise ShapeError(
            "team_count",
            f"{team_count} teams do not divide into groups of {group_size}.",
        )
    group_count = team_count // group_size
    if group_count < 2:
        raise ShapeError("team_count", "A knockout needs at least two groups.")
    if not is_power_of_two(group_count):
        raise ShapeError(
            "team_count",
            f"{group_count} groups send {group_count * ADVANCE_PER_GROUP} teams "
            "through, which is not a bracket. Use a number of groups that halves "
            "cleanly.",
        )
    return Shape(team_count=team_count, group_size=group_size)
