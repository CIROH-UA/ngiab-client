import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { Spinner } from 'react-bootstrap';
import { XButton, LoadingMessage, Row, IconLabel } from '../styles/Styles';
import SelectComponent from '../SelectComponent';
import { toast } from 'react-toastify';
import { loadVpuData, getVariables, getTimeseries } from 'features/DataStream/lib/queryData';
import { makeGpkgUrl, listPublicS3Directories } from 'features/DataStream/lib/s3Utils';
import { getCacheKey } from 'features/DataStream/lib/opfsCache';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import { availableCyclesList, availableEnsembleList, availableForecastList, availableModelsList } from 'features/DataStream/lib/data';
import { makeTitle } from 'features/DataStream/lib/utils';

import {
  ModelIcon,
  DateIcon,
  ForecastIcon,
  CycleIcon,
  EnsembleIcon,
  VariableIcon,
} from 'features/DataStream/lib/layers';

export default function DataMenu() {

  const vpu = useDataStreamStore((state) => state.vpu);
  const date = useDataStreamStore((state) => state.date);
  const forecast = useDataStreamStore((state) => state.forecast);
  const time = useDataStreamStore((state) => state.time);
  const cycle = useDataStreamStore((state) => state.cycle);
  const variables = useDataStreamStore((state) => state.variables);
  const model = useDataStreamStore((state) => state.model);
  const dates = useDataStreamStore((state) => state.dates);

  const set_date = useDataStreamStore((state) => state.set_date);
  const set_dates = useDataStreamStore((state) => state.set_dates);
  const set_forecast = useDataStreamStore((state) => state.set_forecast);
  const set_time = useDataStreamStore((state) => state.set_time);
  const set_cycle = useDataStreamStore((state) => state.set_cycle);
  const set_variables = useDataStreamStore((state) => state.set_variables);
  const set_model = useDataStreamStore((state) => state.set_model);
  const reset_datastream_store = useDataStreamStore((state) => state.reset);

  const variable = useTimeSeriesStore((state) => state.variable);
  const table = useTimeSeriesStore((state) => state.table)
  const set_series = useTimeSeriesStore((state) => state.set_series);
  const set_table = useTimeSeriesStore((state) => state.set_table);
  const set_variable = useTimeSeriesStore((state) => state.set_variable);
  const set_layout = useTimeSeriesStore((state) => state.set_layout);
  const feature_id = useTimeSeriesStore((state) => state.feature_id);


  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  /* ─────────────────────────────────────
     Helpers
     ───────────────────────────────────── */
  const handleLoading = (text) => {
    setLoading(true);
    setLoadingText(text);
  };

  const handleSuccess = () => {
    setLoading(false);
    setLoadingText('');
  };

  const handleError = (text) => {
    toast.error(text, { autoClose: 1000 });
    setLoading(false);
    setLoadingText('');
  };

  const handleVisulization = async () => {
    if (!feature_id || !vpu) {
      handleError('Please select a feature on the map first');
      return;
    }
    const toastId = toast.loading(`Loading data for id: ${feature_id}...`, {
      closeOnClick: false,
      draggable: false,
    });


    const cacheKey = getCacheKey(
      model,
      date,
      forecast,
      cycle,
      time,
      vpu
    );
    const vpu_gpkg = makeGpkgUrl(vpu);      
    const id = feature_id.split('-')[1];
    try {
      handleLoading('Loading Datastream Data');      
      await loadVpuData(model, date, forecast, cycle, time, vpu, vpu_gpkg);
    }
    catch (err) {
      console.error('Error loading VPU data:', err);
      toast.update(toastId, {
        render: `No data for id: ${feature_id}`,
        type: 'warning',
        isLoading: false,
        autoClose: 500,
        closeOnClick: true,
      });
    }
    
    try{
      const variables = await getVariables({cacheKey});
      const _variable = variable ? variable : variables[0];
      const series = await getTimeseries(id, cacheKey, _variable);
      const xy = series.map((d) => ({
        x: new Date(d.time),
        y: d[variables[0]],
      }));

      set_table(cacheKey);
      set_variables(variables);
      set_series(xy);
      set_variable(_variable);
      set_layout({
        'yaxis': _variable,
        'xaxis': "Time",
        'title': makeTitle(forecast, feature_id),
      });
      toast.update(toastId, {
        render: `Loaded data for id: ${feature_id}`,
        type: 'success',
        isLoading: false,
        autoClose: 300,
        closeOnClick: true,
      });     

      handleSuccess();
      
    } catch (err) {
      console.error(err);
      // reset_datastream_store();
      toast.update(toastId, {
        render: `Failed to load data for id: ${feature_id}`,
        type: 'error',
        isLoading: false,
        autoClose: 500,
        closeOnClick: true,
      });
      
      handleError('Error loading datastream data');
    }

  };


  const handleChangeModel = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_model(opt.value);
  };

  const handleChangeDate = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_date(opt.value);
  };

  const handleChangeForecast = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_forecast(opt.value);
    if (opt.value === 'short_range') {
      set_time(null);
    }
  };

  const handleChangeCycle = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_cycle(opt.value);
  };

  const handleChangeEnsemble = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_time(opt.value);
  };

  const handleChangeVariable = async (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_variable(opt.value);
  };

  useEffect(() => {
    async function fetchDates() {
      try {
        const { childNames } = await listPublicS3Directories(`outputs/${model}/v2.2_hydrofabric/`);
        console.log(childNames)
        const options = childNames.map((d) => ({ value: d, label: d }));

        const dateOptions = Array.from(options).sort().reverse();
        console.log('Fetched dates from S3:', dateOptions);
        // setDatesBucket(dateOptions);
        set_dates(dateOptions);
      } catch (error) {
        console.error('Error fetching dates from S3:', error);
      }
    }
    
    fetchDates();

  }, []); // run once on mount

  /* ─────────────────────────────────────
     When forecast changes, ensure cycle/time are valid
     ───────────────────────────────────── */
  useEffect(() => {
    const cycles = availableCyclesList[forecast] || [];
    if (cycles.length && !cycles.some((o) => o.value === cycle)) {
      set_cycle(cycles[0].value);
    }

    const ensembles = availableEnsembleList[forecast] || [];
    if (ensembles.length && !ensembles.some((o) => o.value === time)) {
      set_time(ensembles[0].value);
    }
  }, [forecast, cycle, time]);

  const availableVariablesList = useMemo(() => {
    return variables.map((v) => ({ value: v, label: v }));
  }, [variables]);

  /* ─────────────────────────────────────
     Selected options derived from dsState
     ───────────────────────────────────── */
  const selectedDateOption = useMemo(
    () =>
      // datesBucket.find((opt) => opt.value === date) ??
      dates.find((opt) => opt.value === date) ??
      null,
    // [datesBucket, date]
    [dates, date]
  );

  const selectedForecastOption = useMemo(
    () =>
      availableForecastList.find((opt) => opt.value === forecast) ??
      null,
    [forecast]
  );

  const selectedModelOption = useMemo(
    () =>
      availableModelsList.find((opt) => opt.value === model) ??
      null,
    [model]
  );

  const selectedCycleOption = useMemo(() => {
    const opts = availableCyclesList[forecast] || [];
    return opts.find((opt) => opt.value === cycle) ?? null;
  }, [forecast, cycle]);

  const selectedEnsembleOption = useMemo(() => {
    const opts = availableEnsembleList[forecast] || [];
    return opts.find((opt) => opt.value === time) ?? null;
  }, [forecast, time]);

  const selectedVariableOption = useMemo(() => {
    const opts = availableVariablesList || [];
    return opts.find((opt) => opt.value === variable) ?? null;
  }
  , [variables, variable]);


  /* ─────────────────────────────────────
     Render
     ───────────────────────────────────── */
  return (
    <Fragment>
      <Fragment>
        <Row>
          <IconLabel> <ModelIcon/> Model </IconLabel>
          <SelectComponent
            optionsList={availableModelsList}
            value={selectedModelOption}
            onChangeHandler={handleChangeModel}
          />
        </Row>
           <Row>
            <IconLabel> <DateIcon/> Date</IconLabel>
            <SelectComponent
              optionsList={dates}
              value={selectedDateOption}
              onChangeHandler={handleChangeDate}
            />
          </Row>
        <Row>
          <IconLabel> <ForecastIcon/>  Forecast</IconLabel>
          <SelectComponent
            optionsList={availableForecastList}
            value={selectedForecastOption}
            onChangeHandler={handleChangeForecast}
          />
        </Row>

        {availableCyclesList[forecast]?.length > 0 && (
          <Row>
            <IconLabel> <CycleIcon/> Cycle</IconLabel>
            <SelectComponent
              optionsList={availableCyclesList[forecast]}
              value={selectedCycleOption}
              onChangeHandler={handleChangeCycle}
            />
          </Row>
        )}

        {availableEnsembleList[forecast]?.length > 0 && (
          <Row>
            <IconLabel> <EnsembleIcon/> Ensembles</IconLabel>
            <SelectComponent
              optionsList={availableEnsembleList[forecast]}
              value={selectedEnsembleOption}
              onChangeHandler={handleChangeEnsemble}
            />
          </Row>
        )}
        { availableVariablesList.length > 0 && (
          <Row>
            <IconLabel> <VariableIcon /> Variable</IconLabel>
            <SelectComponent
              optionsList={availableVariablesList}
              value={selectedVariableOption}
              onChangeHandler={handleChangeVariable}
            />
          </Row>
        )}
        <div style={{marginTop: '10px', paddingLeft: '100px', paddingRight: '100px'}}>
          <XButton onClick={handleVisulization}>Update</XButton>
        </div>
      </Fragment>

      <LoadingMessage>
        {loading && (
          <>
            <Spinner
              as="span"
              size="sm"
              animation="border"
              role="status"
              aria-hidden="true"
            />
            &nbsp; {loadingText}
          </>
        )}
      </LoadingMessage>
      <Fragment>
       
      </Fragment>
    </Fragment>
  );
}
