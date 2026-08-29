"""Provision the portal superuser at start, and refuse to serve on a shipped default.

Refuses to start a hosted deployment that is still using the image's baked credentials.
"""

import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from tethysapp.ngiab import duckdb_conn

BAKED_PASSWORD = "pass"
BAKED_SECRET_KEY = "ngiab-local-default-override-in-any-shared-deployment"


class Command(BaseCommand):
    help = "Create or update the portal superuser, refusing shipped defaults when hosted."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check-only",
            action="store_true",
            help="Verify the deployment is not using shipped defaults, and change nothing",
        )

    def handle(self, *args, **options):
        hosted = duckdb_conn.is_object_storage()
        name = os.environ.get("PORTAL_SUPERUSER_NAME", "").strip()
        password = os.environ.get("PORTAL_SUPERUSER_PASSWORD", "")
        email = os.environ.get("PORTAL_SUPERUSER_EMAIL", "").strip()
        secret_key = os.environ.get("TETHYS_SECRET_KEY", "")

        if hosted:
            self._refuse_shipped_defaults(password, secret_key)
            self._require_credentials(name, password)

        if options["check_only"]:
            self.stdout.write("no shipped defaults in use")
            return

        if not name or not password:
            self.stdout.write("no superuser credentials supplied; leaving the database alone")
            return

        user_model = get_user_model()
        user, created = user_model.objects.get_or_create(
            username=name, defaults={"email": email}
        )
        user.email = email or user.email
        user.is_staff = True
        user.is_superuser = True
        user.set_password(password)
        user.save()

        verb = "created" if created else "updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} superuser {name}"))

    def _require_credentials(self, name, password):
        """Refuse a hosted start that supplies no superuser at all."""
        if name and password:
            return
        missing = " and ".join(
            filter(None, [None if name else "PORTAL_SUPERUSER_NAME",
                          None if password else "PORTAL_SUPERUSER_PASSWORD"])
        )
        raise CommandError(
            "Refusing to start a hosted deployment with no superuser configured:\n"
            f"  - {missing} is not set, so the image's baked admin account stays active.\n"
            "Set both, or run with NGIAB_STORAGE_BACKEND unset for a local deployment."
        )

    def _refuse_shipped_defaults(self, password, secret_key):
        """Fail closed when the password or secret key still match the image's published defaults."""
        problems = []
        if password == BAKED_PASSWORD:
            problems.append(
                "PORTAL_SUPERUSER_PASSWORD is still the image's baked default. It is public, "
                "and it is the only thing in front of an irreversible delete."
            )
        if BAKED_SECRET_KEY in (secret_key, getattr(settings, "SECRET_KEY", "")):
            problems.append(
                "TETHYS_SECRET_KEY is still the image's baked default. Session cookies signed "
                "with a published key can be forged."
            )
        if problems:
            raise CommandError(
                "Refusing to start a hosted deployment on shipped credentials:\n  - "
                + "\n  - ".join(problems)
            )
