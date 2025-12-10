import React, {useState, useEffect } from 'react';
import { SearchBarWrapper, SearchIcon, SearchInput } from '../styles/Styles';
import { loadIndexData, getFeatureProperties } from 'features/DataStream/lib/queryData';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import {useFeatureStore} from 'features/DataStream/store/Layers';
import { getTimeseries, getVariables, checkForTable, loadVpuData } from 'features/DataStream/lib/queryData';
import { makeTitle } from 'features/DataStream/lib/utils';
import { getCacheKey } from 'features/DataStream/lib/opfsCache';
import { makeGpkgUrl } from 'features/DataStream/lib/s3Utils';
import ResetDataButton from '../forecast/cacheHandler';

const SearchBar = ({ placeholder = 'Search for an id' }) => {
  const [searchInput, setSearchInput] = useState('');
  const hydrofabric_index_url = useDataStreamStore((state) => state.hydrofabric_index);
  const forecast = useDataStreamStore((state) => state.forecast);
  const model = useDataStreamStore((state) => state.model);
  const date = useDataStreamStore((state) => state.date);
  const cycle = useDataStreamStore((state) => state.cycle);
  const time = useDataStreamStore((state) => state.time);
  const vpu = useDataStreamStore((state) => state.vpu);
  
  const set_table = useTimeSeriesStore((state) => state.set_table);
  const set_variables = useDataStreamStore((state) => state.set_variables);

  const variable = useTimeSeriesStore((state) => state.variable);
  
  const set_series = useTimeSeriesStore((state) => state.set_series);
  const set_layout = useTimeSeriesStore((state) => state.set_layout);
  const set_variable = useTimeSeriesStore((state) => state.set_variable);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);
  const set_selected_feature = useFeatureStore((state) => state.set_selected_feature);

  const handleChange = async (e) => {
    console.log("Search input changed:", e.target.value);
    setSearchInput(e.target.value);
    const unbiased_id = e.target.value;
    const id = unbiased_id.split('-')[1];
    const features = await getFeatureProperties({ cacheKey: 'index_data_table', feature_id: unbiased_id });
    if (features.length === 0) {return};
    set_feature_id(e.target.value);
    const feature = features.length > 0 ? features[0] : null;
    set_selected_feature(feature || null);
    const vpu_str = `VPU_${feature.vpuid}`;
    const cacheKey = getCacheKey(
      model,
      date,
      forecast,
      cycle,
      time,
      vpu_str
    );
    const tableExists = await checkForTable(cacheKey);
    if (!tableExists) {
      await loadVpuData(
        model,
        date,
        forecast,
        cycle,
        time,
        vpu_str,
        makeGpkgUrl(vpu)
      );
    } else {
      console.log(`Table ${cacheKey} already exists.`);
    }
    const variables = await getVariables({cacheKey});
    const _variable = variable ? variable : variables[0];
    console.log("Using variable:", _variable);
    const series = await getTimeseries(id, cacheKey, _variable);
    const xy = series.map((d) => ({
      x: new Date(d.time),
      y: d[variables[0]],
    }));
    set_series(xy);
    set_table(cacheKey);
    set_variables(variables);
    set_variable(_variable);
    set_layout({
      'yaxis': _variable,
      'xaxis': "Time",
      'title': makeTitle(forecast, unbiased_id),
    });
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
    <>
    <SearchBarWrapper>
      <SearchIcon aria-hidden="true" />
      <SearchInput
        type="text"
        value={searchInput || ''}
        onChange={(e) => handleChange(e)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </SearchBarWrapper>
      <ResetDataButton />
    </>
 );
};

export default SearchBar;