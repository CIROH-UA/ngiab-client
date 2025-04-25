import React, { useState, useEffect, Fragment  } from 'react';
import styled from 'styled-components';
import { Form, Button, Alert, Spinner, Stack } from 'react-bootstrap';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';

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

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);

  const handleVisulization = () => {
    const params = {
      avail_date: selectedDate,
      ngen_forecast: selectedForecast,
      ngen_vpu: selectedVpu,
    }
    appAPI.getDataStreamTarFile(params)
    .then((data) => {        
          if (data.error) {
            // toast.error("Error fetching Model Run Data", { autoClose: 1000 });
            return;
          }
          // toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
        })
        .catch((error) => {
          setSuccess(false);
          console.error('Failed', error);
        });
  }

  const handleChangeDate = (e) => {
    setSelectedDate(e[0].value);
    const params = {
      avail_date: e[0].value,
    }
    appAPI.getDataStreamNgiabAvailableForecast(params)
    .then((data) => {
        console.log('Success', data);
        setAvailableForecastList(data.ngen_forecast);
          if (data.error) {
            // toast.error("Error fetching Model Run Data", { autoClose: 1000 });
            return;
          }
  
          // toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
        })
        .catch((error) => {
          setSelectedDate("");

          console.error('Failed', error);
        });

  }

  const handleChangeForecast = (e) => {
    
    const params = {
      avail_date: selectedDate,
      ngen_forecast: e[0].value,
    }
    setSelectedForecast(e[0].value);
    appAPI.getDataStreamNgiabAvailableVpus(params)
    .then((data) => {
        console.log('Success', data);
        setAvailableVpuList(data.ngen_vpus);
          if (data.error) {
            // toast.error("Error fetching Model Run Data", { autoClose: 1000 });
            return;
          }
  
          // toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
        })
        .catch((error) => {
          setSelectedForecast("");
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
          // console.log('Success', data);
            console.log('Success', data);
            setDatesBucket(data.ngen_dates);
              if (data.error) {
                // toast.error("Error fetching Model Run Data", { autoClose: 1000 });
                return;
              }
      
              // toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
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
        success && 
        <StyledButton onClick={handleVisulization}>
          Visualize 
        </StyledButton>
      }


    </Fragment>
  );
}
