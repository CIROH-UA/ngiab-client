import React, {useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiSearch } from 'react-icons/fi';
import { loadIndexData } from 'features/DataStream/lib/indexSearch';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';


const SearchBarWrapper = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 400px;
  padding: 6px 10px;
  border-radius: 6px;
  background-color: #f5f7f8;
  box-sizing: border-box;
  border: 1px solid #e1e4e8;
`;

const SearchIcon = styled(FiSearch)`
  flex-shrink: 0;
  margin-right: 8px;
  color: #9ca3af;
  font-size: 16px;
`;

const SearchInput = styled.input`
  border: none;
  outline: none;
  width: 500px;
  font-size: 14px;
  background: transparent;
  color: #111827;

  &::placeholder {
    color: #9ca3af;
  }
`;



const PARQUETURL= 'http://localhost:9000/ciroh-community-ngen-datastream/v2.2_resources/nexu_divides_index.parquet';

const SearchBar = ({ placeholder = 'Search for an id' }) => {

  const feature_id = useTimeSeriesStore((state) => state.feature_id);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);

  useEffect(() => {
    const loadSearchData = async () => {
      try {
        await loadIndexData({ remoteUrl: PARQUETURL } );
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