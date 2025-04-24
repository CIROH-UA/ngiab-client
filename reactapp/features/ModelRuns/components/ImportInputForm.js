import React, { useState, useEffect } from 'react';
import { use } from 'react';
import { Form, Button, Alert, Spinner, Stack } from 'react-bootstrap';
import appAPI from 'services/api/app';

// helper that validates and calls your backend
function importFromS3(name, url) {
  if (!name.trim()) throw new Error('Name is required');
  // try {
  //   new URL(url);
  // } catch {
  //   throw new Error('Not a valid URL');
  // }

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


export default function ImportInputForm() {
  const [name, setName] = useState('');
  const [url,  setUrl]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);

  const handleImport = (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      importFromS3(name.trim(), url.trim());
      setSuccess(true);
      setName('');
      setUrl('');
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (error) {
      setTimeout(() => {
        setError(null);
      }, 3000);
    }
  }
  , [error]);
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
    <Form onSubmit={handleImport}>
      <Stack gap={3}>
        {/* model-run name */}
        <Form.Group controlId="model-name">
          <Form.Label>Model-run name</Form.Label>
          <Form.Control
            type="text"
            placeholder="e.g. Run 2025-04-23"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </Form.Group>

        {/* S3 URL */}
        <Form.Group controlId="s3-url">
          <Form.Label>S3 bucket link</Form.Label>
          <Form.Control
            type="url"
            placeholder="https://my-bucket.s3.amazonaws.com/folder/"
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
          />
        </Form.Group>

        {/* submit button */}
        <Button
          variant="primary"
          type="submit"
          disabled={loading || !name.trim() || !url.trim()}
        >
          {loading ? (
            <>
              <Spinner as="span" size="sm" animation="border" role="status" aria-hidden="true" />
              &nbsp;Importing…
            </>
          ) : (
            'Import'
          )}
        </Button>

        {/* alerts */}
        {error   && <Alert variant="danger"  dismissible onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert variant="success" dismissible onClose={() => setSuccess(false)}>Import successful!</Alert>}
      </Stack>
    </Form>
  );
}
