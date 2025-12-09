import React, {useState, useEffect } from 'react';
import { SearchBarWrapper, SearchIcon, SearchInput } from '../styles';
import { loadIndexData } from 'features/DataStream/lib/indexSearch';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';
import useDataStreamStore from 'features/DataStream/store/datastream';


const SearchBar = ({ placeholder = 'Search for an id' }) => {
  const hydrofabric_index_url = useDataStreamStore((state) => state.hydrofabric_index);
  const feature_id = useTimeSeriesStore((state) => state.feature_id);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);

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
        onChange={(e) => set_feature_id(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </SearchBarWrapper>
  );
};

export default SearchBar;