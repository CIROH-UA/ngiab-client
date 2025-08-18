import React, { Component, useCallback } from 'react';
import Select, { createFilter } from 'react-select';
import { FixedSizeList as List } from 'react-window';

const height = 35;

class MenuList extends Component {
  render() {
    const { options, children, maxHeight, getValue } = this.props;
    const [value] = getValue();

    const safeMaxHeight = typeof maxHeight === 'number' && !isNaN(maxHeight) ? maxHeight : 300;
    const safeChildrenLength = Array.isArray(children) ? children.length : 0;

    const valueIndex = options.indexOf(value);
    const initialOffset = valueIndex >= 0 ? valueIndex * height : 0;
    
    // Calculate dynamic height based on number of options
    const dynamicHeight = Math.min(safeChildrenLength * height, safeMaxHeight);
    const adjustedHeight = Math.max(dynamicHeight, height); // Minimum height of one option

    return (
      <List
        height={adjustedHeight}
        itemCount={children.length}
        itemSize={height}
        initialScrollOffset={initialOffset}
      >
        {({ index, style }) => <div style={style}>{children[index]}</div>}
      </List>
    );
  }
}

// Custom styles for react-select - matching hydrofabric styling
const customStyles = {
  control: (provided, state) => ({
    ...provided,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: state.isFocused ? '1px solid #cafeff' : '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    boxShadow: state.isFocused ? '0 0 0 1px #cafeff' : 'none',
    minHeight: '40px',
    '&:hover': {
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
  }),
  menu: (provided, state) => ({
    ...provided,
    backgroundColor: '#4f5b67',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
    // Dynamic height based on options
    maxHeight: state.options ? Math.min(state.options.length * 35, 300) : 300,
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isFocused 
      ? 'rgba(255, 255, 255, 0.1)' 
      : 'transparent',
    color: '#ffffff',
    padding: '10px 16px',
    '&:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  }),
  singleValue: (provided) => ({
    ...provided,
    color: '#ffffff',
    fontWeight: '400',
  }),
  input: (provided) => ({
    ...provided,
    color: '#ffffff',
  }),
  placeholder: (provided) => ({
    ...provided,
    color: 'rgba(255, 255, 255, 0.6)',
  }),
  indicatorSeparator: (provided) => ({
    ...provided,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  }),
  dropdownIndicator: (provided) => ({
    ...provided,
    color: '#ffffff',
    '&:hover': {
      color: '#cafeff',
    },
  }),
  clearIndicator: (provided) => ({
    ...provided,
    color: '#ffffff',
    '&:hover': {
      color: '#cafeff',
    },
  }),
};

const SelectComponent = ({ 
  optionsList,
  onChangeHandler, 
  // defaultValue 
}) => {
  const handleChange = useCallback((option) => {
    onChangeHandler([option]);
  }, [onChangeHandler]);

  return (
    <Select
      components={{ MenuList }}
      styles={customStyles}
      filterOption={createFilter({ ignoreAccents: false })}
      options={optionsList}
      onChange={handleChange}
      // value={defaultValue}
      menuPortalTarget={document.body}
      menuShouldScrollIntoView={false}
      menuPosition="fixed"
    />
  );
};

export default SelectComponent;
