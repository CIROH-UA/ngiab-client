
"""Drop the run registry; the storage root is the registry now.

Downgrade below this point is unsupported: the table is gone and 0003 is recorded.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('ngiab', '0002_normalize_model_run_ids'),
    ]

    operations = [
        migrations.DeleteModel(
            name='ModelRun',
        ),
    ]
