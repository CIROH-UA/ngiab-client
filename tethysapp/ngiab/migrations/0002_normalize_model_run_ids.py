"""Repair model run ids stored with dashes.

Django writes a UUIDField to SQLite as 32 hex characters with no dashes, and builds its
lookups the same way. A row inserted by anything other than the ORM -- a hand-edited
database, a raw INSERT, an import script -- can hold the 36-character dashed form instead.
Such a row reads back correctly, so it appears in the run picker, but no filter(id=...)
will ever match it: unregistering it answers "No such model run" about a run plainly on
screen, and there is no way out of that from the interface.

Rewrites the id in place rather than dropping the row, so ``?model_run_id=<uuid>`` links
and the run's identity survive.
"""

from django.db import migrations


def normalize(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM ngiab_modelrun")
        ids = [row[0] for row in cursor.fetchall()]

        for stored in ids:
            text = str(stored)
            if "-" not in text:
                continue
            cursor.execute(
                "UPDATE ngiab_modelrun SET id = %s WHERE id = %s",
                [text.replace("-", ""), text],
            )


class Migration(migrations.Migration):
    dependencies = [("ngiab", "0001_initial")]

    # Reverse would put the dashes back, which is the broken state.
    operations = [migrations.RunPython(normalize, migrations.RunPython.noop)]
