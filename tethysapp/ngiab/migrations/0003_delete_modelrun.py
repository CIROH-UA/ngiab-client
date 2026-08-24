
"""Drop the run registry. The storage root is the registry now.

Deliberately a pure DeleteModel. Writing the manifests these rows become is
``backfill_manifests``, which the entrypoint runs *before* migrate -- distilling a run reads
its GeoPackage and a crosswalk of tens of thousands of rows, and doing that here would run it
during ``tethys db migrate`` with no progress output, no bound, and a container that never
serves if any of it failed.

0001 and 0002 stay. Every existing deployment has their rows in django_migrations and the
table on a host volume; deleting those files would orphan both, leaving the table on disk
forever with Django no longer able to drop it.

Downgrade below this point is unsupported: an older image's code stops at 0002 while
django_migrations records 0003 and ngiab_modelrun is gone.
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
