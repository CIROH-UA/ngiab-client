# tethysapp/ngiab/consumers/handlers/home_import_handler.py
from __future__ import annotations
import asyncio
import logging
from typing import Any, Dict

from ...datastream_utils import (
    check_if_s3_uri_exists,
    download_and_extract_tar_from_s3_uri,
    parse_s3_uri,
)

log = logging.getLogger(__name__)

class HomeImportHandler:
    def __init__(self, consumer):
        self.consumer = consumer
        self.receiving_actions = {
            "IMPORT_FROM_S3": self.import_from_s3,
            "IMPORT_CHECK": self.import_check,
        }

    async def import_check(self, event: Dict[str, Any], action: Dict[str, Any], data: Dict[str, Any]):
        # NEW: prefer s3_uri; fall back to legacy bucket/key if provided
        s3_uri = (data.get("s3_uri") or "").strip()
        if not s3_uri and data.get("bucket") and data.get("tar_key"):
            s3_uri = f"s3://{str(data['bucket']).strip()}/{str(data['tar_key']).lstrip('/')}"

        if not s3_uri:
            await self.consumer.send_error("Missing 's3_uri' in payload.", action, data)
            return

        try:
            exists = await asyncio.to_thread(check_if_s3_uri_exists, s3_uri)
            await self.consumer.send_action("IMPORT_CHECK_RESULT", {"s3_uri": s3_uri, "exists": bool(exists)})
        except Exception as e:
            await self.consumer.send_error(f"Import check failed: {e}", action, data)

    async def import_from_s3(self, event: Dict[str, Any], action: Dict[str, Any], data: Dict[str, Any]):
        # NEW: prefer s3_uri; maintain backward compatibility
        s3_uri = (data.get("s3_uri") or "").trim() if hasattr(str, "trim") else (data.get("s3_uri") or "").strip()
        if not s3_uri and data.get("bucket") and data.get("tar_key"):
            s3_uri = f"s3://{str(data['bucket']).strip()}/{str(data['tar_key']).lstrip('/')}"

        name_folder = (data.get("name_folder") or "").strip()
        if not s3_uri:
            await self.consumer.send_error("Missing 's3_uri' in payload.", action, data)
            return

        await self.consumer.send_acknowledge("Starting S3 import…", action, data)
        await self.consumer.send_action("IMPORT_PROGRESS", {"stage": "download", "s3_uri": s3_uri})

        try:
            datastream_id = await asyncio.to_thread(
                download_and_extract_tar_from_s3_uri,
                s3_uri=s3_uri,
                name_folder=name_folder,
            )
            # include parsed pieces for clients that still expect them
            try:
                bucket, tar_key = parse_s3_uri(s3_uri)
            except Exception:
                bucket, tar_key = None, None

        except Exception as e:
            log.exception("Import failed.")
            await self.consumer.send_error(f"Import failed: {e}", action, data)
            return

        await self.consumer.send_action(
            "IMPORT_DONE",
            {
                "id": datastream_id,
                "s3_uri": s3_uri,
                "bucket": bucket,
                "tar_key": tar_key,
                "name_folder": name_folder or (tar_key.split("/")[-1] if tar_key else "ngen-run"),
            },
        )
