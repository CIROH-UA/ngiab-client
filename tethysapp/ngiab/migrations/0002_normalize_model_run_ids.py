"""Normalise stored run ids to one spelling so a shared link resolves."""

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

    operations = [migrations.RunPython(normalize, migrations.RunPython.noop)]
