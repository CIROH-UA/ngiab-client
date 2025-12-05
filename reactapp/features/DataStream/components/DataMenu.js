import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { Spinner } from 'react-bootstrap';
import { XButton, LoadingMessage, Row, IconLabel } from './StyledComponents/ts';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import { toast } from 'react-toastify';
import { loadVpuData, getVariables } from 'features/DataStream/lib/vpuDataLoader';
import { getNCFiles, makeGpkgUrl } from '../lib/s3Utils';
import { getTimeseries } from 'features/DataStream/lib/getTimeSeries';
import { getCacheKey } from '../lib/opfsCache';
import useTimeSeriesStore from '../store/timeseries';
import useDataStreamStore from '../store/datastream';
import { MdOutlineWaves, MdCalendarMonth, MdOutlineRefresh } from "react-icons/md";
import { BsExclamationCircle } from "react-icons/bs";
import { availableCyclesList, availableEnsembleList, availableForecastList } from '../lib/data';

import { makeTitle } from '../lib/utils';

export default function DataMenu() {
  const [datesBucket, setDatesBucket] = useState([]);

  const vpu = useDataStreamStore((state) => state.vpu);
  const date = useDataStreamStore((state) => state.date);
  const forecast = useDataStreamStore((state) => state.forecast);
  const time = useDataStreamStore((state) => state.time);
  const cycle = useDataStreamStore((state) => state.cycle);
  const variables = useDataStreamStore((state) => state.variables);

  const set_date = useDataStreamStore((state) => state.set_date);
  const set_forecast = useDataStreamStore((state) => state.set_forecast);
  const set_time = useDataStreamStore((state) => state.set_time);
  const set_cycle = useDataStreamStore((state) => state.set_cycle);
  const set_variables = useDataStreamStore((state) => state.set_variables);

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

  /* ─────────────────────────────────────
     Visualization
     ───────────────────────────────────── */
  const handleVisulization = async () => {
    try {
      handleLoading('Loading Datastream Data');
      const nc_files_parsed = await getNCFiles(
        date,
        forecast,
        cycle,
        time,
        vpu
      );

      const vpu_gpkg = makeGpkgUrl(vpu);
      
      const cacheKey = getCacheKey(
        date,
        forecast,
        cycle,
        time,
        vpu
      );
      set_table(cacheKey)
      
      const id = feature_id.split('-')[1];
      
      await loadVpuData({
        cacheKey,
        nc_files: nc_files_parsed,
        vpu_gpkg,
      });
      const variables = await getVariables({cacheKey});
      set_variables(variables);
      console.log('Available variables:', variables);
      const _variable = variable ? variable : variables[0];
      const series = await getTimeseries(id, cacheKey, _variable);
      const xy = series.map((d) => ({
        x: new Date(d.time),
        y: d[variables[0]],
      }));

      set_series(xy);
      set_variable(_variable);
      set_layout({
        'yaxis': _variable,
        'xaxis': "Time",
        'title': makeTitle(forecast, feature_id),
      })

      console.log('Flow timeseries for', id, xy);
      handleSuccess();
    } catch (err) {
      console.error(err);
      handleError('Error loading datastream data');
    }
  };

  /* ─────────────────────────────────────
     Select change handlers
     ───────────────────────────────────── */
  const handleChangeDate = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_date(opt.value);
  };

  const handleChangeForecast = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) set_forecast(opt.value);
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
    const id =  feature_id.split('-')[1];
    console.log(table)
    const series = await getTimeseries(id, table, opt.value);
    const xy = series.map((d) => ({
      x: new Date(d.time),
      y: d[opt.value],
    }));
    set_series(xy);
    set_layout({
      'yaxis': opt.value,
      'xaxis': "Time",
      'title': `${id} ${opt.value}`
    })
  };
  /* ─────────────────────────────────────
     Fetch available dates (once)
     ───────────────────────────────────── */
  useEffect(() => {
    appAPI
      .getDataStreamNgiabDates()
      .then((data) => {
        if (data.error) {
          toast.error('Error Datastream Dates From S3 Bucket', {
            autoClose: 1000,
          });
          return;
        }

        setDatesBucket(data.ngen_dates);

        // Set default date in dsState if not already set
        if (!date && data.ngen_dates?.length) {
          const def = data.ngen_dates[0]; // or last element if you want most recent
          set_date(def.value ?? def); // depends on shape
        }

        toast.success('Successfully retrieved Datastream Dates From S3 Bucket', {
          autoClose: 1000,
        });
      })
      .catch((error) => {
        console.error('Failed', error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      datesBucket.find((opt) => opt.value === date) ??
      null,
    [datesBucket, date]
  );

  const selectedForecastOption = useMemo(
    () =>
      availableForecastList.find((opt) => opt.value === forecast) ??
      null,
    [forecast]
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
        {datesBucket.length > 0 && (
          <Row>
            <IconLabel> <MdCalendarMonth/> Date</IconLabel>
            <SelectComponent
              optionsList={datesBucket}
              value={selectedDateOption}
              onChangeHandler={handleChangeDate}
            />
          </Row>
        )}
        <Row>
          <IconLabel> <BsExclamationCircle/>  Forecast</IconLabel>
          <SelectComponent
            optionsList={availableForecastList}
            value={selectedForecastOption}
            onChangeHandler={handleChangeForecast}
          />
        </Row>

        {availableCyclesList[forecast]?.length > 0 && (
          <Row>
            <IconLabel> <MdOutlineRefresh/> Cycle</IconLabel>
            <SelectComponent
              optionsList={availableCyclesList[forecast]}
              value={selectedCycleOption}
              onChangeHandler={handleChangeCycle}
            />
          </Row>
        )}

        {availableEnsembleList[forecast]?.length > 0 && (
          <Row>
            <IconLabel> <MdOutlineWaves/> Ensembles</IconLabel>
            <SelectComponent
              optionsList={availableEnsembleList[forecast]}
              value={selectedEnsembleOption}
              onChangeHandler={handleChangeEnsemble}
            />
          </Row>
        )}
        { availableVariablesList.length > 0 && (
          <Row>
            <IconLabel> <MdOutlineWaves/> Variable</IconLabel>
            <SelectComponent
              optionsList={availableVariablesList}
              value={selectedVariableOption}
              onChangeHandler={handleChangeVariable}
            />
          </Row>
        )}
        <XButton onClick={handleVisulization}>Update</XButton>
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
