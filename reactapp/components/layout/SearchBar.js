import React, {useState, useEffect } from 'react';
import { SearchBarWrapper, SearchIcon, SearchInput } from '../styles';
import { loadIndexData, getFeatureProperties } from 'features/DataStream/lib/indexSearch';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';
import useDataStreamStore from 'features/DataStream/store/datastream';
import {useFeatureStore} from 'features/DataStream/store/layers';
// import { getFeatureAtLngLat } from 'features/DataStream/lib/utils';

const SearchBar = ({ placeholder = 'Search for an id' }) => {
  const hydrofabric_index_url = useDataStreamStore((state) => state.hydrofabric_index);
  const feature_id = useTimeSeriesStore((state) => state.feature_id);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);
  const set_selected_feature = useFeatureStore((state) => state.set_selected_feature);

  const handleChange = async (e) => {
    set_feature_id(e.target.value);
    const properties = await getFeatureProperties({ cacheKey: 'index_data_table', feature_id: e.target.value })
    console.log("Feature properties:", properties);
    // needs to amke a map part of the feature store, and that way we can access it here
    // const feature = getFeatureAtLngLat(map, selectedLng, selectedLat, layersToQuery);
    set_selected_feature(properties[0] || null);
  }

  useEffect(() => {
    const loadSearchData = async () => {
      try {
        await loadIndexData({ remoteUrl: hydrofabric_index_url } );
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    loadSearchData();
    return () => {
    };
  }, []); // dependencies array

  return (
    <SearchBarWrapper>
      <SearchIcon aria-hidden="true" />
      <SearchInput
        type="text"
        value={feature_id || ''}
        onChange={(e) => handleChange(e)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </SearchBarWrapper>
  );
};

export default SearchBar;