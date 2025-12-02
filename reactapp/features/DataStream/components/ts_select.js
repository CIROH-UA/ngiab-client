import React, { useState, useEffect, useMemo, Fragment } from 'react';
import styled from 'styled-components';
import { Button, Row, Spinner } from 'react-bootstrap';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import { toast } from 'react-toastify';
import { loadVpuData } from 'features/DataStream/lib/vpuDataLoader';
import { getNCFiles, makeGpkgUrl } from '../lib/s3Utils';
import { getFlowTimeseriesForNexus } from 'features/DataStream/lib/nexusTimeseries';
import { getCacheKey } from '../lib/opfsCache';
import { useDataStreamContext } from '../hooks/useDataStreamContext';
import useTimeSeriesStore from '../store/timeseries';
import { MdOutlineWaves, MdCalendarMonth, MdOutlineRefresh } from "react-icons/md";
import { BsExclamationCircle } from "react-icons/bs";



const StyledButton = styled(Button)`  
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  border-radius: 2px;
  padding: 7px 8px;
  width: 100%;
  z-index: 1001;

  &:hover,
  &:focus {
    background-color: rgba(0, 0, 0, 0.1) !important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

const StyledLoadingMessage = styled.div`
  color: white;
  padding: 10px;
  border-radius: 5px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  width: 100%;
  text-align: center;
  opacity: 0.8;
  transition: opacity 0.3s ease;
  &:hover {
    opacity: 1;
  }
`;

const RowStyle = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
`;

const IconLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
`



const availableForecastList = [
  { value: 'short_range', label: 'short_range' },
  { value: 'medium_range', label: 'medium_range' },
  { value: 'analysis_assim_extend', label: 'analysis_assim_extend' },
];

const availableCyclesList = {
  short_range: [
    { value: '00', label: '00' },
    { value: '01', label: '01' },
    { value: '02', label: '02' },
    { value: '03', label: '03' },
    { value: '04', label: '04' },
    { value: '05', label: '05' },
    { value: '06', label: '06' },
    { value: '07', label: '07' },
    { value: '08', label: '08' },
    { value: '09', label: '09' },
    { value: '10', label: '10' },
    { value: '11', label: '11' },
    { value: '12', label: '12' },
    { value: '13', label: '13' },
    { value: '14', label: '14' },
    { value: '15', label: '15' },
    { value: '16', label: '16' },
    { value: '17', label: '17' },
  ],
  medium_range: [
    { value: '00', label: '00' },
    { value: '06', label: '06' },
    { value: '12', label: '12' },
  ],
  analysis_assim_extend: [{ value: '16', label: '16' }],
};

const availableEnsembleList = {
  short_range: [],
  medium_range: [{ value: '1', label: '1' }],
  analysis_assim_extend: [],
};

export default function BucketSelect() {
  const [datesBucket, setDatesBucket] = useState([]);

  const { state: dsState, actions: dsActions } = useDataStreamContext();
  const set_series = useTimeSeriesStore((state) => state.set_series);
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
        dsState.date,
        dsState.forecast,
        dsState.cycle,
        dsState.time,
        dsState.vpu
      );
      const vpu_gpkg = makeGpkgUrl(dsState.vpu);
      const cacheKey = getCacheKey(
        dsState.date,
        dsState.forecast,
        dsState.cycle,
        dsState.time,
        dsState.vpu
      );
      const id = feature_id.split('-')[1];

      await loadVpuData({
        cacheKey,
        nc_files: nc_files_parsed,
        vpu_gpkg,
      });

      const series = await getFlowTimeseriesForNexus(id, cacheKey);
      const xy = series.map((d) => ({
        x: new Date(d.time),
        y: d.flow,
      }));

      set_series(xy);
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
    if (opt) dsActions.set_date(opt.value);
  };

  const handleChangeForecast = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) dsActions.set_forecast(opt.value);
  };

  const handleChangeCycle = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) dsActions.set_cycle(opt.value);
  };

  const handleChangeEnsemble = (optionArray) => {
    const opt = optionArray?.[0];
    if (opt) dsActions.set_time(opt.value);
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
        if (!dsState.date && data.ngen_dates?.length) {
          const def = data.ngen_dates[0]; // or last element if you want most recent
          dsActions.set_date(def.value ?? def); // depends on shape
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
    const cycles = availableCyclesList[dsState.forecast] || [];
    if (cycles.length && !cycles.some((o) => o.value === dsState.cycle)) {
      dsActions.set_cycle(cycles[0].value);
    }

    const ensembles = availableEnsembleList[dsState.forecast] || [];
    if (ensembles.length && !ensembles.some((o) => o.value === dsState.time)) {
      dsActions.set_time(ensembles[0].value);
    }
  }, [dsState.forecast, dsState.cycle, dsState.time, dsActions]);

  /* ─────────────────────────────────────
     Selected options derived from dsState
     ───────────────────────────────────── */
  const selectedDateOption = useMemo(
    () =>
      datesBucket.find((opt) => opt.value === dsState.date) ??
      null,
    [datesBucket, dsState.date]
  );

  const selectedForecastOption = useMemo(
    () =>
      availableForecastList.find((opt) => opt.value === dsState.forecast) ??
      null,
    [dsState.forecast]
  );

  const selectedCycleOption = useMemo(() => {
    const opts = availableCyclesList[dsState.forecast] || [];
    return opts.find((opt) => opt.value === dsState.cycle) ?? null;
  }, [dsState.forecast, dsState.cycle]);

  const selectedEnsembleOption = useMemo(() => {
    const opts = availableEnsembleList[dsState.forecast] || [];
    return opts.find((opt) => opt.value === dsState.time) ?? null;
  }, [dsState.forecast, dsState.time]);

  /* ─────────────────────────────────────
     Render
     ───────────────────────────────────── */
  return (
    <Fragment>
      <Fragment>
        {datesBucket.length > 0 && (
          <RowStyle>
            <IconLabel> <MdCalendarMonth/> Date</IconLabel>
            <SelectComponent
              optionsList={datesBucket}
              value={selectedDateOption}
              onChangeHandler={handleChangeDate}
            />
          </RowStyle>
        )}
        <RowStyle>
          <IconLabel> <BsExclamationCircle/>  Forecast</IconLabel>
          <SelectComponent
            optionsList={availableForecastList}
            value={selectedForecastOption}
            onChangeHandler={handleChangeForecast}
          />
        </RowStyle>

        {availableCyclesList[dsState.forecast]?.length > 0 && (
          <RowStyle>
            <IconLabel> <MdOutlineRefresh/> Cycle</IconLabel>
            <SelectComponent
              optionsList={availableCyclesList[dsState.forecast]}
              value={selectedCycleOption}
              onChangeHandler={handleChangeCycle}
            />
          </RowStyle>
        )}

        {availableEnsembleList[dsState.forecast]?.length > 0 && (
          <RowStyle>
            <IconLabel> <MdOutlineWaves/> Ensembles</IconLabel>
            <SelectComponent
              optionsList={availableEnsembleList[dsState.forecast]}
              value={selectedEnsembleOption}
              onChangeHandler={handleChangeEnsemble}
            />
          </RowStyle>
        )}

        <StyledButton onClick={handleVisulization}>Visualize</StyledButton>
      </Fragment>

      <StyledLoadingMessage>
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
      </StyledLoadingMessage>
    </Fragment>
  );
}
