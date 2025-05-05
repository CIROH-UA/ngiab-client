import React, { useState, useEffect, Fragment  } from 'react';
import styled from 'styled-components';
import { Button, Spinner} from 'react-bootstrap';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import { toast } from 'react-toastify';

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



function isMoreRecent(dateStr, threshold = "20250429") {
  // Quick lexicographical check (works because YYYYMMDD sorts correctly as strings)
  return dateStr > threshold;
}

export default function BucketNamesSelect() {
  const [datesBucket, setDatesBucket] = useState([]);
  const [availableForecastList, setAvailableForecastList] = useState([]);
  const [availableVpuList, setAvailableVpuList] = useState([]);

  const [availableCyclesList, setAvailableCyclesList] = useState([]);
  const [availableEnsembleList, setAvailableEnsembleList] = useState([]);
  
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedForecast, setSelectedForecast] = useState('');
  const [selectedVpu, setSelectedVpu] = useState('');
  
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [selectedEnsemble, setSelectedEnsemble] = useState(null);

  const {state,actions} = useModelRunsContext();

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loadingText, setLoadingText] = useState("");


  const resetDates = () => {
    setAvailableForecastList([]);
    setAvailableCyclesList([]);
    setAvailableEnsembleList([]);
    setAvailableVpuList([]);
    setSelectedForecast("");
    setSelectedCycle(null);
    setSelectedEnsemble(null);
    setSelectedVpu("");
    setSuccess(false);
  }
  const resetForecast = () => {
    setAvailableCyclesList([]);
    setAvailableEnsembleList([]);
    setAvailableVpuList([]);
    setSelectedCycle(null);
    setSelectedEnsemble(null);
    setSelectedVpu("");
    setSuccess(false);

  }
  const resetCycle = () => {
    setAvailableEnsembleList([]);
    setAvailableVpuList([]);
    setSelectedEnsemble(null);
    setSelectedVpu("");
    setSuccess(false);

  }
  const resetEnsemble = () => {
    setAvailableVpuList([]);
    setSelectedVpu("");
    setSuccess(false);

  }

  const resetVpu = () => {
    setSelectedVpu("");
    setSuccess(false);
  }


  const handleLoading = (text) => {
    setLoading(true);
    setLoadingText(text);
  }
  const handleSuccess = () => {
    // setSuccess(true);
    setLoading(false);
    setLoadingText("");
  }
  
  const handleError = (text) => {
    setSuccess(false);
    toast.error(text, { autoClose: 1000 });
    setLoading(false);
    setLoadingText("");
  }
  

  const handleVisulization = () => {
    handleLoading("Loading Datastream Data");
    const params = {
      avail_date: selectedDate,
      ngen_forecast: selectedForecast,
      ngen_vpu: selectedVpu,
      ngen_cycle: selectedCycle,
      ngen_ensemble: selectedEnsemble,
    }


    appAPI.getDataStreamTarFile(params)
    .then((data) => {
          if (data.error) {
            handleError("Error fetching Datastream Data");
            return;
          }
          actions.set_base_model_id(data.id);
          handleSuccess();
          // toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
        })
        .catch((error) => {
          handleError("Error Loading Datastream Data");
          console.error('Failed', error);
        });
  }

  const handleChangeDate = (e) => {
    handleLoading("Loading Available Forecast...");
    setSelectedDate(e[0].value);
    resetDates();
    const params = {
      avail_date: e[0].value,
    }
    appAPI.getDataStreamNgiabAvailableForecast(params)
    .then((data) => {
          if (data.error) {
            handleError("Error fetching Available Forecast...");
            return;
          }
          setAvailableForecastList(data.ngen_forecast);
          handleSuccess();
        })
        .catch((error) => {
          setSelectedDate("");
          handleError("Error Loading Datastream Data");
          console.error('Failed', error);
        });

  }

  const handleChangeForecast = (e) => {
    const params = {
      avail_date: selectedDate,
      ngen_forecast: e[0].value,
    }
    resetForecast();
    setSelectedForecast(e[0].value);
    console.log("Selected Date", selectedDate.split(".")[1]);

    const GETCYCLES = isMoreRecent(selectedDate.split(".")[1]);

    if (GETCYCLES) {
      handleLoading("Loading Available Init Cycles...");
      appAPI.getDataStreamNgiabAvailableCycles(params)
      .then((data) => {
            if (data.error) {
              handleError("Error fetching Available Cycles...");
              return;
            }
            setAvailableCyclesList(data.ngen_cycles);
            handleSuccess();
          })
          .catch((error) => {
            setSelectedForecast("");
            handleError("Error Loading Available Cycles...");
            console.error('Failed', error);
          });
    }
    else{
      handleLoading("Loading Available VPUs...");

      appAPI.getDataStreamNgiabAvailableVpus(params)
      .then((data) => {
            if (data.error) {
              handleError("Error fetching Available VPUs...");
              return;
            }
            
            setAvailableVpuList(data.ngen_vpus);
            handleSuccess();
          })
          .catch((error) => {
            setSelectedForecast("");
            handleError("Error Loading Available VPUs...");
            console.error('Failed', error);
          });
    }
    

  }

  const handleChangeCycle = (e) => {
    const params = {
      avail_date: selectedDate,
      ngen_forecast: selectedForecast,
      ngen_cycle: e[0].value,
    }
    resetCycle();
    setSelectedCycle(e[0].value);
    if (selectedForecast === 'medium_range'){
      handleLoading("Loading Available Ensembles...");

      appAPI.getDataStreamNgiabAvailableEnsembles(params)
      .then((data) => {
            if (data.error) {
              handleError("Error fetching Available Ensembles...");
              return;
            }
            setAvailableEnsembleList(data.ngen_ensembles);
            handleSuccess();
          })
          .catch((error) => {
            setSelectedCycle(null);
            handleError("Error Loading Available Ensembles...");
            console.error('Failed', error);
          });
    }
    else{
      handleLoading("Loading Available VPUs...");

      appAPI.getDataStreamNgiabAvailableVpus(params)
      .then((data) => {
            if (data.error) {
              handleError("Error fetching Available VPUs...");
              return;
            }
            setAvailableVpuList(data.ngen_vpus);
            handleSuccess();
          })
          .catch((error) => {
            setSelectedCycle(null);
            handleError("Error Loading Available VPUs...");
            console.error('Failed', error);
          });
    }

  }   

  const handleChangeEnsemble = (e) => {
    handleLoading("Loading Available VPUs...");
    const params = {
      avail_date: selectedDate,
      ngen_forecast: selectedForecast,
      ngen_cycle: selectedCycle,
      ngen_ensemble: e[0].value,
    }
    resetEnsemble();
    setSelectedEnsemble(e[0].value);
    appAPI.getDataStreamNgiabAvailableVpus(params)
    .then((data) => {
          if (data.error) {
            handleError("Error fetching Available VPUs...");
            return;
          }
          setAvailableVpuList(data.ngen_vpus);
          handleSuccess();
        })
        .catch((error) => {
          setSelectedEnsemble(null);
          handleError("Error Loading Available VPUs...");
          console.error('Failed', error);
        });
  }


  const handleChangeVpu = (e) => {
    resetVpu();
    setSelectedVpu(e[0].value);
    setSuccess(true);
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
        {availableForecastList.length > 0 &&
          <Fragment>
            <p>Available Forecasts</p>
            <SelectComponent 
              optionsList={availableForecastList} 
              onChangeHandler={handleChangeForecast}
            />
          </Fragment>
        }
        {availableCyclesList.length > 0 &&
          <Fragment>
            <br/>
            <p>Available Cycles</p>
            <SelectComponent 
              optionsList={availableCyclesList} 
              onChangeHandler={handleChangeCycle}
            />
          </Fragment>
        }
        {availableEnsembleList.length > 0 &&
          <Fragment>
            <br/>
            <p>Available Ensembles</p>
            <SelectComponent 
              optionsList={availableEnsembleList} 
              onChangeHandler={handleChangeEnsemble}
            />
          </Fragment>
        }

        {availableVpuList.length > 0 &&
          <Fragment>
            <br/>
            <p>Available VPUs</p>
            <SelectComponent 
              optionsList={availableVpuList} 
              onChangeHandler={handleChangeVpu}
            />
          </Fragment>
        }
        <br/>
        {
          success && 
          <StyledButton onClick={handleVisulization}>
            Visualize 
          </StyledButton>
        }
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
