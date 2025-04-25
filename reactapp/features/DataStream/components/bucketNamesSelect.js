import React, { useState, useEffect } from 'react';
import { use } from 'react';
import { Form, Button, Alert, Spinner, Stack } from 'react-bootstrap';
import appAPI from 'services/api/app';

export default function BucketNamesSelect() {
  const [name, setName] = useState('');
  const [url,  setUrl]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);




  useEffect(() => {
    if (success) {
      const params = {
        model_run_name: name.trim(),
        model_run_s3_path: url.trim(),   // keep raw
      };
    
      appAPI.importModelRuns(params)
        .then((data) => {
            console.log('Success', data);
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
  }, [success]);

  return (
    <></>
  );
}
