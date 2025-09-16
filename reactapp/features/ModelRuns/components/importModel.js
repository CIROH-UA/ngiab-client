import React, { Fragment, useState, useContext } from 'react';
import styled from 'styled-components';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import Form from 'react-bootstrap/Form';
import { toast } from 'react-toastify';
import { AppContext } from "context/context";

const ThemedModal = styled(Modal)`
  .modal-content {
    background: #2c3e50;
    color: #ecf0f1;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 12px 32px rgba(0,0,0,0.35);
  }
  .modal-header, .modal-footer {
    border-color: rgba(255,255,255,0.12);
  }
  .modal-title {
    color: #ffffff;
    font-weight: 600;
  }
  .form-label {
    color: #dbeafe;
    margin-bottom: 0.35rem;
  }
  .form-control {
    background: rgba(255,255,255,0.08);
    color: #ffffff;
    border-color: rgba(255,255,255,0.2);
  }
  .form-control::placeholder {
    color: rgba(255,255,255,0.65);
  }
  .btn-primary {
    background: #3b82f6;
    border-color: #3b82f6;
  }
  .btn-primary:hover {
    filter: brightness(1.05);
  }
  .btn-secondary {
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.18);
    color: #e5e7eb;
  }
`;

const deriveDefaultName = (uri) => {
  const last = (uri || '').split('/').pop() || '';
  return last.replace(/\.(tar\.gz|tar\.bz2|tar\.xz|tgz|tbz2|txz|tar)$/i, '');
};

const ImportModel = () => {
  const { backend } = useContext(AppContext);
  
  const [showS3Modal, setShowS3Modal] = useState(false);
  const [s3Uri, setS3Uri] = useState('s3://ciroh-community-ngen-datastream/demo/default/ngen-run.tar.gz');
  const [folderName, setFolderName] = useState('');

  const openModal = () => setShowS3Modal(true);
  const closeModal = () => setShowS3Modal(false);

  const submitS3Import = async (e) => {
    e.preventDefault();
    if (!s3Uri.trim()) {
      toast.warning('Please provide the S3 URI to a tar file, e.g. s3://bucket/path/run.tar.gz');
      return;
    }
    const name_folder = folderName.trim() || deriveDefaultName(s3Uri) || 'ngen-run';
    try {
      backend.do('IMPORT_FROM_S3', { s3_uri: s3Uri.trim(), name_folder });
      closeModal();
      toast.info('Starting import from S3…');
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  };

  return (
    <Fragment>
      <Button
        variant="primary"
        onClick={openModal}
        title="Import from S3"
        aria-label="Import from S3"
        style={{ width: '100%', marginTop: '10px' }}
      >
         Import Model
      </Button>

      <ThemedModal show={showS3Modal} onHide={closeModal}>
        <Form onSubmit={submitS3Import}>
          <Modal.Header closeButton>
            <Modal.Title>Import from 🪣 S3 Bucket</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>S3 URI</Form.Label>
              <Form.Control
                autoFocus
                placeholder="s3://bucket/prefix/ngen-run.tar.gz"
                value={s3Uri}
                onChange={(e) => setS3Uri(e.target.value)}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Local folder name</Form.Label>
              <Form.Control
                placeholder="(optional) e.g. my-ngen-run"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button type="submit" variant="primary">Import</Button>
          </Modal.Footer>
        </Form>
      </ThemedModal>
    </Fragment>
  );
};

export default ImportModel;
