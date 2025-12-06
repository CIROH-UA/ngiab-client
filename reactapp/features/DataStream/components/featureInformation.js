// GaugeInformation.js
import React, { Fragment } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { IconLabel, FieldBlock, FieldValue, FieldsGrid, FieldLabel, HeaderRow } from './styles/styles';
import { useFeatureStore } from 'features/DataStream/store/layers';
import { formatLabel } from '../lib/utils';
import { BasinSymbol } from '../lib/layers';
export const FeatureInformation = () => {
  const selectedFeature = useFeatureStore((state) => state.selected_feature);

  if (!selectedFeature) {
    return null; // or <Panel>No gauge selected</Panel>
  }

  // Pull out lat/lon so we can render them together
  const { lat, latitude, lon, longitude, ...restProps } = selectedFeature;
  const latVal = lat ?? latitude;
  const lonVal = lon ?? longitude;

  const fields = [];

  if (latVal != null && lonVal != null) {
    const latNum = Number(latVal);
    const lonNum = Number(lonVal);
    const latLon =
      !Number.isNaN(latNum) && !Number.isNaN(lonNum)
        ? `${latNum.toFixed(6)}, ${lonNum.toFixed(6)}`
        : `${latVal}, ${lonVal}`;

    fields.push({
      label: 'Lat/Long',
      value: latLon,
    });
  }

  // Add remaining properties dynamically
  Object.entries(restProps).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    let displayValue = value;

    if (typeof value === 'boolean') {
        displayValue = value ? 'Yes' : 'No';
    }else if (typeof value === 'number') {
        displayValue = value.toFixed(4);
    }

    fields.push({
      label: formatLabel(key),
      value: displayValue,
    });
  });

  return (
    <Fragment>

      <HeaderRow>
        <IconLabel $fontSize={14}>
          <span style={{ fontWeight: 600 }}>Feature Information</span>
          <MdInfoOutline size={16} />
        </IconLabel>
      </HeaderRow>

      <FieldsGrid>
        {fields.map(({ label, value }) => (
          <FieldBlock key={label}>
            <FieldLabel>
              {
                label.includes('km2') ?
                (
                  <BasinSymbol stroke ={'#009989'} fill={'#009989'} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                ) : null
                
              }
              {label}
              </FieldLabel>
            <FieldValue>{value}</FieldValue>
          </FieldBlock>
        ))}
      </FieldsGrid>
    </Fragment>
  );
};
