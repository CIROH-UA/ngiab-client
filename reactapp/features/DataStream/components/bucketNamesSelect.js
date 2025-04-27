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

export default function BucketNamesSelect() {
  const [datesBucket, setDatesBucket] = useState([]);
  const [availableForecastList, setAvailableForecastList] = useState([]);
  const [availableVpuList, setAvailableVpuList] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedForecast, setSelectedForecast] = useState('');
  const [selectedVpu, setSelectedVpu] = useState('');

  const {state,actions} = useModelRunsContext();

  const [loading, setLoading] = useState(false);
  // const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);
  const [loadingText, setLoadingText] = useState("");


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
    handleLoading("Loading Available VPUs...");
    const params = {
      avail_date: selectedDate,
      ngen_forecast: e[0].value,
    }
    setSelectedForecast(e[0].value);
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

  const handleChangeVpu = (e) => {
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
      {datesBucket.length > 0 &&
        <Fragment>
          <p>Available Dates</p>
          <SelectComponent 
            optionsList={datesBucket} 
            onChangeHandler={handleChangeDate}
          />
        </Fragment>
      }
      <br />
      {availableForecastList.length > 0 &&
        <Fragment>
          <p>Available Forecasts</p>
          <SelectComponent 
            optionsList={availableForecastList} 
            onChangeHandler={handleChangeForecast}
          />
        </Fragment>
      }
      <br />
      {availableVpuList.length > 0 &&
        <Fragment>
          <p>Available VPUs</p>
          <SelectComponent 
            optionsList={availableVpuList} 
            onChangeHandler={handleChangeVpu}
          />
        </Fragment>
      }
       <br />
      {
        loading &&
        <>
          <Spinner as="span" size="sm" animation="border" role="status" aria-hidden="true" />
          &nbsp; {loadingText}
        </>
      }
      <br />
      {
        success && 
        <StyledButton onClick={handleVisulization}>
          Visualize 
        </StyledButton>
      }
    </Fragment>
  );
}
