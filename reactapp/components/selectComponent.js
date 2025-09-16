import React, { Component, useCallback } from 'react';
import Select, { createFilter } from 'react-select';
import { FixedSizeList as List } from 'react-window';

const height = 35;

class MenuList extends Component {
  render() {
    const { options, children, maxHeight, getValue } = this.props;
    const [value] = getValue();
    const initialOffset = options.indexOf(value) * height;

    // Dynamically adjust maxHeight
    const adjustedHeight = Math.min(children.length * height, maxHeight);

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

// Custom styles for react-select
const customStyles = {
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (provided) => ({
    ...provided,
    // maxHeight: '500px',
    overflowY: 'auto',
  }),
  option: (provided) => ({
    ...provided,
    color: 'black',
  }),
  singleValue: (provided) => ({
    ...provided,
    color: 'black',
  }),
  input: (provided) => ({
    ...provided,
    color: 'black',
  }),
};

const SelectComponent = ({ 
  optionsList,
  onChangeHandler, 
  
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
      menuPortalTarget={document.body}
      menuShouldScrollIntoView={false}
      menuPosition="fixed"
    />
  );
};

export default SelectComponent;
