import React, { useState, useEffect, Fragment  } from 'react';
import styled from 'styled-components';
import { Button, Spinner} from 'react-bootstrap';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import { toast } from 'react-toastify';
import { loadVpuData } from "features/DataStream/lib/vpuDataLoader";
import { getNCFiles, makeGpkgUrl } from '../lib/s3Utils';
import { getFlowTimeseriesForNexus } from "features/DataStream/lib/nexusTimeseries";
import { getCacheKey } from '../lib/opfsCache';
import { useDataStreamContext } from '../hooks/useDataStreamContext';
import useTimeSeriesStore from '../store/timeseries';

const StyledButton = styled(Button)`  
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  border-radius: 2px;
  padding: 7px 8px;
  width: 100%;
  z-index: 1001;

  &:hover, &:focus {
    background-color: rgba(0, 0, 0, 0.1)!important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

const StyledLoadingMessage = styled.div`
  // position: absolute;
  // top: 50%;
  // left: 50%;
  color: white;
  padding: 10px;
  border-radius: 5px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  width: 1005;
  text-align: center;
  opacity: 0.8;
  transition: opacity 0.3s ease;
  &:hover {
    opacity: 1;
  }
`;


const availableForecastList = [
  {"value": 'short_range', 'label': 'short_range'},
  {"value": 'medium_range', 'label': 'medium_range'},
  {'value': 'analysis_assim_extend', 'label': 'analysis_assim_extend'},
]
const availableCyclesList = {
  'short_range': [
    {"value": '00', 'label': '00'},
    {"value": '01', 'label': '01'},
    {"value": '02', 'label': '02'},
    {"value": '03', 'label': '03'},
    {"value": '04', 'label': '04'},
    {"value": '05', 'label': '05'},
    {"value": '06', 'label': '06'},
    {"value": '07', 'label': '07'},
    {"value": '08', 'label': '08'},
    {"value": '09', 'label': '09'},
    {"value": '10', 'label': '10'},
    {"value": '11', 'label': '11'},
    {"value": '12', 'label': '12'},
    {"value": '13', 'label': '13'},
    {"value": '14', 'label': '14'},
    {"value": '15', 'label': '15'},
    {"value": '16', 'label': '16'},
    {"value": '17', 'label': '17'},
  ],
  'medium_range': [
    {"value": '00', 'label': '00'},
    {"value": '06', 'label': '06'},
    {"value": '12', 'label': '12'},
  ],
  'analysis_assim_extend': [
    {"value": '16', 'label': '16'},
  ]
}
const availableEnsembleList = {
  'short_range': [],
  'medium_range': [
    {"value": '1', 'label':'1'}
  ],
  'analysis_assim_extend': [],
}

export default function BucketSelect() {
  const [datesBucket, setDatesBucket] = useState([]);
  
  // const [availableForecastList, setAvailableForecastList] = useState([]);
  // const [availableVpuList, setAvailableVpuList] = useState([]);

  // const [availableCyclesList, setAvailableCyclesList] = useState([]);
  // const [availableEnsembleList, setAvailableEnsembleList] = useState([]);
  
  // const [selectedDate, setSelectedDate] = useState('');
  // const [selectedForecast, setSelectedForecast] = useState('');
  // const [selectedVpu, setSelectedVpu] = useState('');
  
  // const [selectedCycle, setSelectedCycle] = useState(null);
  // const [selectedEnsemble, setSelectedEnsemble] = useState(null);

  // const {state,actions} = useModelRunsContext();

  const {state: dsState, actions: dsActions} = useDataStreamContext();
  const set_series = useTimeSeriesStore((state) => state.set_series);
  const feature_id = useTimeSeriesStore((state) => state.feature_id);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loadingText, setLoadingText] = useState("");


  const resetDates = () => {

    setSuccess(false);
  }
  const resetForecast = () => {

    setSuccess(false);

  }
  const resetCycle = () => {

    setSuccess(false);

  }
  const resetEnsemble = () => {

    setSuccess(false);

  }

  const handleLoading = (text) => {
    setLoading(true);
    setLoadingText(text);
  }
  const handleSuccess = () => {
    setLoading(false);
    setLoadingText("");
  }
  
  const handleError = (text) => {
    setSuccess(false);
    toast.error(text, { autoClose: 1000 });
    setLoading(false);
    setLoadingText("");
  }
  

  const handleVisulization = async () => {
    handleLoading("Loading Datastream Data");
    const nc_files_parsed = await getNCFiles(dsState.date , dsState.forecast, dsState.cycle, dsState.time, dsState.vpu);
    const vpu_gpkg = makeGpkgUrl(dsState.vpu);
    const cacheKey = getCacheKey(dsState.date , dsState.forecast, dsState.cycle, dsState.time, dsState.vpu);
    console.log(vpu_gpkg, nc_files_parsed, cacheKey);
    const id = feature_id.split('-')[1];
    await loadVpuData({
      cacheKey: cacheKey,
      nc_files: nc_files_parsed,
      vpu_gpkg,
    });
    const series = await getFlowTimeseriesForNexus(id, cacheKey);
    const xy = series.map(d => ({
      x: new Date(d.time),
      y: d.flow,
    }));
    
    set_series(xy);
    console.log("Flow timeseries for", id, xy);
    handleSuccess();
  }

  const handleChangeDate = (e) => {
    // handleLoading("Loading Available Forecast...");
    dsActions.set_date(e[0].value);
  }

  const handleChangeForecast = (e) => {    
    dsActions.set_forecast(e[0].value);
    // handleLoading("Loading Available Init Cycles...");
  }

  const handleChangeCycle = (e) => {
    dsActions.set_cycle(e[0].value);
    // handleLoading("Loading Available VPUs...");
  }   

  const handleChangeEnsemble = (e) => {
    // handleLoading("Loading Available VPUs...");
    dsActions.set_time(e[0].value);    
  }




  useEffect(() => {    
      appAPI.getDataStreamNgiabDates()
        .then((data) => {
              
              if (data.error) {
                toast.error("Error Datastream Dates From S3 Bucket", { autoClose: 1000 });
                return;
              }
              setDatesBucket(data.ngen_dates);
              toast.success("Successfully retrieved Datastream Dates From S3 Bucket", { autoClose: 1000 });
            })
            .catch((error) => {
              console.error('Failed', error);
            });
  }, []);


  return (
    <Fragment>
      <Fragment>
        {datesBucket.length > 0 &&
          <Fragment>
            <p>Available Dates</p>
            <SelectComponent 
              optionsList={datesBucket} 
              onChangeHandler={handleChangeDate}
            />
          </Fragment>
        }
        <br/>
        
          <Fragment>
            <p>Available Forecasts</p>
            <SelectComponent 
              optionsList={availableForecastList} 
              onChangeHandler={handleChangeForecast}
            />
          </Fragment>

        { availableCyclesList[`${dsState.forecast}`].length > 0 &&
          <Fragment>
            <br/>
            <p>Available Cycles</p>
            <SelectComponent 
              optionsList={availableCyclesList[`${dsState.forecast}`]} 
              onChangeHandler={handleChangeCycle}
            />
          </Fragment>
        }
        {availableEnsembleList[`${dsState.forecast}`].length > 0 &&
          <Fragment>
            <br/>
            <p>Available Ensembles</p>
            <SelectComponent 
              optionsList={availableEnsembleList[`${dsState.forecast}`]} 
              onChangeHandler={handleChangeEnsemble}
            />
          </Fragment>
        }  
          <StyledButton onClick={handleVisulization} > 
            Visualize 
          </StyledButton>
      

      </Fragment>
      <StyledLoadingMessage>
            {
              loading &&
              <>
                <Spinner as="span" size="sm" animation="border" role="status" aria-hidden="true" />
                &nbsp; {loadingText}
              </>
            }
      </StyledLoadingMessage>
    </Fragment>

  );
}
  // const handleChangeVpu = async (e) => {
  //   const vpu = e[0].value;
  //   // handleLoading("Loading Parquet File For VPU...");
  //   resetVpu();
  //   const base_prefix = makePrefix(selectedDate, selectedForecast, selectedCycle, selectedEnsemble, e[0].value);
  //   const files_prefix = await listPublicS3Files(base_prefix);
  //   console.log("files_prefix", files_prefix);
  //   const nc_files = files_prefix.filter(f => f.endsWith('.nc'));
  //   const nc_files_parsed = nc_files.map(f => `s3://${BUCKET}/${f}`);

  //   try {
  //     const vpu_gpkg = `s3://ciroh-community-ngen-datastream/v2.2_resources/${vpu}/config/nextgen_${vpu}.gpkg`;

  //     await loadVpuData({
  //       baseCacheKey: base_prefix,
  //       nc_files: nc_files_parsed,
  //       vpu_gpkg,
  //     });

  //     dsActions.set_cache_key(base_prefix);
  //     dsActions.set_vpu(vpu);

  //     setSelectedVpu(vpu);
  //     const needed_vpu = vpu_layers[vpu];
  //     // actions.set_current_geometry(needed_vpu);
  //     dsActions.set_geometry(needed_vpu);
  //     setSuccess(true);
  //     handleSuccess();
  //   } catch (error) {
  //     console.error("Failed", error);
  //     setSelectedVpu("");
  //     handleError("Error Loading Parquet File For VPU...");
  //   }
  // }
