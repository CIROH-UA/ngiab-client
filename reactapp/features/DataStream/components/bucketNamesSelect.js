import React, { useState, useEffect, Fragment  } from 'react';

import { Form, Button, Alert, Spinner, Stack } from 'react-bootstrap';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';




export default function BucketNamesSelect() {
  const [datesBucket, setDatesBucket] = useState([]);
  const [availableForecastList, setAvailableForecastList] = useState([]);
  const [name, setName] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);


  const handleChangeDate = (e) => {
    console.log('Selected date:', e);
    const params = {
      avail_date: e[0].value,
    }
    appAPI.getDataStreamNgiabAvailableForecast(params)
    .then((data) => {
      // console.log('Success', data);
        console.log('Success', data);
        setAvailableForecastList(data.ngen_forecast);
          if (data.error) {
            // toast.error("Error fetching Model Run Data", { autoClose: 1000 });
            return;
          }
  
          // toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
        })
        .catch((error) => {
          console.error('Failed', error);
        });

  }

  const handleChangeForecast = (e) => {
    console.log('Selected forecast:', e);


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
            <SelectComponent 
              optionsList={datesBucket} 
              onChangeHandler={handleChangeDate}
            />
        </Fragment>
    }
    {availableForecastList.length > 0 &&
        <Fragment>
            <SelectComponent 
              optionsList={availableForecastList} 
              onChangeHandler={handleChangeForecast}
            />
        </Fragment>
    }

    </Fragment>
  );
}
