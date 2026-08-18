"""Database models for the NGIAB visualizer.

Model runs used to live in a JSON file on the host: one the launcher wrote, the app only
read, and a human had to hand-edit to fix. The database is the only registry now, so the
app owns it and runs can be added and removed from the UI.

This works only because ``conf/portal_config.yml`` lists ``tethysapp.ngiab`` in
INSTALLED_APPS. Tethys's own app discovery loads apps dynamically for routing and does not
register them with Django, so without that entry these models -- and their migrations --
would be silently invisible.
"""

import uuid

from django.db import models


class ModelRun(models.Model):
    """One registered NGIAB model run."""

    # A UUID so a shared link of the form ?model_run_id=<uuid> stays stable, and so ids
    # minted before the database existed keep working.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    label = models.CharField(max_length=255)

    # Path as seen INSIDE the container (e.g. /var/lib/tethys_persist/ngiab_visualizer/x).
    # Not unique: the same directory is legitimately registered more than once today, once
    # per import, and de-duplicating would silently drop rows on migration.
    path = models.CharField(max_length=1024)

    subset = models.CharField(max_length=255, blank=True, default="")
    tags = models.JSONField(default=list, blank=True)

    # Resolved by _resolve_configuration_name when absent; persisted when the producer's
    # manifest supplied one, since that is authoritative and cannot be re-derived.
    teehr_configuration_name = models.CharField(max_length=255, blank=True, default="")

    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created", "label"]

    def __str__(self):
        return f"{self.label} ({self.id})"

    def as_dict(self):
        """The dict shape every reader already expects from the registry."""
        return {
            "label": self.label,
            "path": self.path,
            "date": self.created.strftime("%Y-%m-%d:%H:%M:%S") if self.created else "",
            "id": str(self.id),
            "subset": self.subset,
            "tags": self.tags or [],
            "teehr_configuration_name": self.teehr_configuration_name,
        }
