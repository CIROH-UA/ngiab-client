"""Provision the portal superuser at start, and refuse to serve on a shipped default.

    tethys manage ensure_superuser

The image bakes ``admin``/``pass`` into the database at build time so a laptop container is
usable the moment it starts. That is fine while nothing can be lost through the interface and
the port is on someone's own machine. It stops being fine here for two reasons at once:
authentication became the only thing standing in front of a destructive action, and the
hosted database is ephemeral -- so those baked credentials do not merely persist, they are
*restored* on every restart, in a public image, where anybody can read them.

So in hosted mode this refuses to start rather than serve with them. A deployment that cannot
boot is a bad afternoon; a deployment that boots with published credentials in front of a
delete button is a bad quarter.

Locally nothing changes: with no credentials supplied and no object-storage backend, this is
a no-op and the baked superuser stays exactly as it is.
"""

import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

# What the image ships. Matching either of these in a hosted deployment is the failure.
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
        hosted = os.environ.get("NGIAB_STORAGE_BACKEND", "").strip().lower() == "s3"
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
        """Refuse a hosted start that supplies no superuser at all.

        _refuse_shipped_defaults only fires on a password that is *supplied and wrong*. With
        none supplied the command fell through to "leaving the database alone" and started
        anyway -- on the baked admin/pass account, which is in a public image and which an
        ephemeral database restores on every restart. The gate was checking the lock and
        ignoring the open window.
        """
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
        """Fail closed. Both of these are published in a public image.

        The secret key is checked twice, against the environment and against the key Django
        will actually sign with. They can disagree: the runtime stage sets the default through
        ENV and portal-config.sh merges it into the rendered config, so an operator who sets
        the variable but whose value never reaches settings would pass an environment-only
        check while signing cookies with the published key.
        """
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
