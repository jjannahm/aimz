"""Newcomer intake, onboarding state, invitation context, and squad staff.

Revision ID: 20260910_0026
Revises: 20260828_0025
Create Date: 2026-09-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260910_0026"
down_revision: str | None = "20260828_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("onboarding_status", sa.String(16), nullable=False, server_default="approved"),
    )
    op.create_index("ix_users_onboarding_status", "users", ["onboarding_status"])
    op.add_column("registration_invites", sa.Column("team_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_registration_invites_team",
        "registration_invites",
        "teams",
        ["team_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_registration_invites_team_id", "registration_invites", ["team_id"])

    op.create_table(
        "newcomer_applications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("stage", sa.String(24), nullable=False, server_default="new"),
        sa.Column("outcome", sa.String(24), nullable=True),
        sa.Column("client_submission_id", sa.String(64), nullable=True, unique=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("player_id", sa.String(36), sa.ForeignKey("players.id", ondelete="SET NULL")),
        sa.Column(
            "invite_id",
            sa.String(36),
            sa.ForeignKey("registration_invites.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "suggested_team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="SET NULL")
        ),
        sa.Column("branch", sa.String(120), nullable=False),
        sa.Column("full_name", sa.String(160), nullable=False),
        sa.Column("mobile", sa.String(60), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("whatsapp_mobile", sa.String(60), nullable=False),
        sa.Column("date_of_birth", sa.String(10), nullable=False),
        sa.Column("nationality", sa.String(100), nullable=False),
        sa.Column("address", sa.String(500), nullable=False),
        sa.Column("previous_academy", sa.String(200), nullable=False),
        sa.Column("school_university", sa.String(200), nullable=False),
        sa.Column("father_name", sa.String(160), nullable=False),
        sa.Column("father_mobile", sa.String(60), nullable=False),
        sa.Column("mother_name", sa.String(160), nullable=False),
        sa.Column("mother_mobile", sa.String(60), nullable=False),
        sa.Column("medical_concerns", sa.Text(), nullable=False),
        sa.Column("medications", sa.Text(), nullable=False),
        sa.Column("consent_version", sa.String(40), nullable=False),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_contacted_at", sa.DateTime(timezone=True)),
        sa.Column("next_follow_up_at", sa.DateTime(timezone=True)),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("redacted_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "source IN ('public_link','account_registration')", name="ck_newcomer_source"
        ),
        sa.CheckConstraint(
            "stage IN ('new','contacted','follow_up','trial_booked','closed')",
            name="ck_newcomer_stage",
        ),
        sa.CheckConstraint(
            "outcome IS NULL OR outcome IN ('joined','not_interested','declined')",
            name="ck_newcomer_outcome",
        ),
    )
    for column in (
        "source",
        "stage",
        "outcome",
        "client_submission_id",
        "user_id",
        "player_id",
        "invite_id",
        "suggested_team_id",
        "full_name",
        "mobile",
        "email",
        "whatsapp_mobile",
        "next_follow_up_at",
        "closed_at",
    ):
        op.create_index(f"ix_newcomer_applications_{column}", "newcomer_applications", [column])
    op.create_index(
        "ix_newcomers_queue", "newcomer_applications", ["stage", "next_follow_up_at", "created_at"]
    )
    op.add_column("registration_invites", sa.Column("application_id", sa.String(36)))
    op.create_foreign_key(
        "fk_registration_invites_application",
        "registration_invites",
        "newcomer_applications",
        ["application_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_registration_invites_application_id", "registration_invites", ["application_id"]
    )
    op.create_table(
        "newcomer_notes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "application_id",
            sa.String(36),
            sa.ForeignKey("newcomer_applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_newcomer_notes_application_id", "newcomer_notes", ["application_id"])
    op.create_table(
        "newcomer_rate_limits",
        sa.Column("key_hash", sa.String(64), primary_key=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index(
        "ix_newcomer_rate_limits_window_started_at", "newcomer_rate_limits", ["window_started_at"]
    )
    op.create_table(
        "team_staff",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_team_staff_team_id", "team_staff", ["team_id"])


def downgrade() -> None:
    op.drop_table("team_staff")
    op.drop_table("newcomer_rate_limits")
    op.drop_table("newcomer_notes")
    op.drop_constraint(
        "fk_registration_invites_application", "registration_invites", type_="foreignkey"
    )
    op.drop_index("ix_registration_invites_application_id", table_name="registration_invites")
    op.drop_column("registration_invites", "application_id")
    op.drop_table("newcomer_applications")
    op.drop_constraint("fk_registration_invites_team", "registration_invites", type_="foreignkey")
    op.drop_index("ix_registration_invites_team_id", table_name="registration_invites")
    op.drop_column("registration_invites", "team_id")
    op.drop_index("ix_users_onboarding_status", table_name="users")
    op.drop_column("users", "onboarding_status")
