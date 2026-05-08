import { useEffect, useMemo, Fragment } from 'react';
import { toast } from 'react-toastify';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';

import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';

// Color tokens for severity-based hint styling. These match the app's
// existing Bootstrap-adjacent palette; dark/light-mode contrast is
// achieved via semi-transparent backgrounds so the text color reads on
// either sidebar background.
const hintStyle = (severity) => {
  const base = {
    fontSize: '0.85em',
    margin: '0.35rem 0',
    padding: '0.25rem 0.5rem',
    borderLeft: '2px solid transparent',
    lineHeight: 1.3,
  };
  if (severity === 'error') {
    return { ...base, color: '#d9534f', borderLeftColor: '#d9534f' };
  }
  if (severity === 'warning') {
    return { ...base, color: '#e0a800', borderLeftColor: '#e0a800' };
  }
  // info (default) -- subtle neutral
  return { ...base, color: 'inherit', opacity: 0.75 };
};

const ariaLiveFor = (severity) => (severity === 'error' ? 'assertive' : 'polite');

const TeehrStatusHint = ({ status }) => {
  if (!status || !status.message) return null;
  return (
    <div
      role="status"
      aria-live={ariaLiveFor(status.severity)}
      style={hintStyle(status.severity)}
    >
      {status.message}
    </div>
  );
};

// Transform the backend's flat variable_list into a single "This run" group.
// Shapes the forward-compatible "grouped options" contract so the cross-run
// follow-up can add additional groups without changing this component.
const toGroupedOptions = (flatList) => {
  if (!flatList || flatList.length === 0) return [];
  return [{ label: 'This run', options: flatList }];
};

const TeehrSelect = (props) => {
  const { state, actions } = useHydroFabricContext();
  const { state: modelRunsState } = useModelRunsContext();

  useEffect(() => {
    if (!state.teehr.id) return;
    const params = { model_run_id: modelRunsState.base_model_id };
    appAPI
      .getTeehrVariables(params)
      .then((response) => {
        actions.set_teehr_variable_list(response.teehr_variables || []);
        actions.set_teehr_status({
          message: response.teehr_status ?? null,
          severity: response.teehr_status_severity ?? null,
        });
        props.toggleSingleRow(false);
        props.setIsLoading(false);
      })
      .catch((error) => {
        props.setIsLoading(false);
        console.log('Error fetching teehr variables', error);
        actions.set_teehr_status({
          message: 'Could not load TEEHR variables.',
          severity: 'error',
        });
      });
    return () => {
      if (state.teehr.id) return;
      actions.reset_teehr();
    };
  }, [state.teehr.id]);

  useEffect(() => {
    if (!state.teehr.variable || !state.teehr.id) return;
    props.setIsLoading(true);
    const params = {
      teehr_id: state.teehr.id,
      teehr_variable: state.teehr.variable,
      model_run_id: modelRunsState.base_model_id,
    };
    appAPI
      .getTeehrTimeSeries(params)
      .then((response) => {
        actions.set_teehr_series(response.data || []);
        actions.set_teehr_chart_layout(response.layout);
        actions.set_teehr_metrics(response.metrics || []);
        actions.set_teehr_status({
          message: response.teehr_status ?? null,
          severity: response.teehr_status_severity ?? null,
        });
        props.toggleSingleRow(false);
        props.setIsLoading(false);
      })
      .catch((error) => {
        props.setIsLoading(false);
        console.log('Error fetching teehr time series', error);
        toast.error('Error fetching TEEHR time series', { autoClose: 1500 });
        actions.set_teehr_status({
          message: 'Could not load TEEHR time series for this selection.',
          severity: 'error',
        });
      });
    return () => {
      if (state.teehr.id) return;
      actions.reset_teehr();
    };
  }, [state.teehr.variable]);

  const grouped = useMemo(
    () => toGroupedOptions(state.teehr.variable_list),
    [state.teehr.variable_list]
  );

  if (!state.teehr.id) return null;

  // After a location is selected, the TEEHR section header and the hint
  // region render unconditionally. The dropdown itself only renders when
  // variable_list is non-empty; empty state is communicated via the hint.
  const hasVariables = (state.teehr.variable_list || []).length > 0;
  return (
    <Fragment>
      <label>TEEHR</label>
      <TeehrStatusHint status={state.teehr.status} />
      {hasVariables && (
        <SelectComponent
          optionsList={grouped}
          onChangeHandler={actions.set_teehr_variable}
          virtualize={false}
        />
      )}
    </Fragment>
  );
};

export default TeehrSelect;
