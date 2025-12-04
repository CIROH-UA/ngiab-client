export const availableForecastList = [
  { value: 'short_range', label: 'short_range' },
  { value: 'medium_range', label: 'medium_range' },
  { value: 'analysis_assim_extend', label: 'analysis_assim_extend' },
];

export const availableCyclesList = {
  short_range: [
    { value: '00', label: '00' },
    { value: '01', label: '01' },
    { value: '02', label: '02' },
    { value: '03', label: '03' },
    { value: '04', label: '04' },
    { value: '05', label: '05' },
    { value: '06', label: '06' },
    { value: '07', label: '07' },
    { value: '08', label: '08' },
    { value: '09', label: '09' },
    { value: '10', label: '10' },
    { value: '11', label: '11' },
    { value: '12', label: '12' },
    { value: '13', label: '13' },
    { value: '14', label: '14' },
    { value: '15', label: '15' },
    { value: '16', label: '16' },
    { value: '17', label: '17' },
  ],
  medium_range: [
    { value: '00', label: '00' },
    { value: '06', label: '06' },
    { value: '12', label: '12' },
  ],
  analysis_assim_extend: [{ value: '16', label: '16' }],
};

export const availableEnsembleList = {
  short_range: [],
  medium_range: [{ value: '1', label: '1' }],
  analysis_assim_extend: [],
};