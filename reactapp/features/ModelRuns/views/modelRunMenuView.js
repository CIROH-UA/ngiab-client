import React, { Fragment, useEffect, useContext } from 'react';
import NgenMenuWrapper from 'features/ngen/components/ngenMenus';
import ModelRunsSelect from '../components/modelRunsSelect';
import { AppContext } from "context/context";
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import { toast } from 'react-toastify';
import { mode } from 'd3-array';

const ModelRunMenuView = ({
  toggleSingleRow,
  setIsLoading,
  setIsMenuOpen,
  singleRowOn
}) => {
  const { backend } = useContext(AppContext);
  const { actions: modelRunActions } = useModelRunsContext();

  useEffect(() => {
    if (!backend) return;

    backend.on('MESSAGE_ACKNOWLEDGE', ({ message }) => {
      toast.info(message ?? 'Acknowledged.', { position: 'top-right', autoClose: 2000 });
    });

    // 2) progress while importing
    backend.on('IMPORT_PROGRESS', ({ stage, s3_uri }) => {
      setIsLoading?.(true);
      toast.dismiss('import-progress');
      toast.loading(
        `Importing from S3 (${stage || 'working'})…${s3_uri ? `\n${s3_uri}` : ''}`,
        { toastId: 'import-progress', position: 'top-right' }
      );
    });

    // 3) done → fetch geospatial + notify
    backend.on('IMPORT_DONE', async ({ id, mode_run_select }) => {
      try {
        modelRunActions.set_model_run_list(mode_run_select);
        modelRunActions.set_base_model_id(id);
        // server guarantees data is ready before sending IMPORT_DONE (see backend patch)
        // const url = `${window.location.pathname}getGeoSpatialData?model_run_id=${encodeURIComponent(id)}`;
        // const res = await fetch(url);
        // if (!res.ok) throw new Error(`Geo load failed: ${res.status}`);

        toast.dismiss('import-progress');
        toast.success('S3 data imported and map data loaded.', { position: 'top-right' });
      } catch (err) {
        toast.dismiss('import-progress');
        toast.error(`Finished import but failed to load map data: ${String(err.message || err)}`);
      } finally {
        setIsLoading?.(false);
        setIsMenuOpen?.(false);
      }
    });

    return () => {
      backend.off('MESSAGE_ACKNOWLEDGE');
      backend.off('IMPORT_PROGRESS');
      backend.off('IMPORT_DONE');
      toast.dismiss('import-progress');
    };
  }, [backend, setIsLoading, setIsMenuOpen]);
  
  return (
    <Fragment>
      <NgenMenuWrapper 
          toggleSingleRow={toggleSingleRow}
          setIsLoading={setIsLoading}
          setIsNgenMenuOpen={setIsMenuOpen}
          singleRowOn={singleRowOn}
          MenuComponent={ModelRunsSelect}
      />
    </Fragment>

  );
};

export default ModelRunMenuView;