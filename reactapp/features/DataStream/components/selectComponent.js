import React, { Component, useCallback } from 'react';
import Select, { createFilter } from 'react-select';
import { FixedSizeList as List } from 'react-window';

const height = 28;

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
        style={
          { overflowX: 'hidden'}
        }
      >
        {({ index, style }) => <div style={style}>{children[index]}</div>}
      </List>
    );
  }
}

const customStyles = (width = 150) => ({
  container: (base) => ({
    ...base,
    width,               // 👈 control overall width
  }),

  control: (base, state) => ({
    ...base,
    minHeight: 28,
    height: 28,
    fontSize: 12,
    borderRadius: 4,
    paddingTop: 0,
    paddingBottom: 0,
    boxShadow: state.isFocused ? '0 0 0 1px #2684ff' : 'none',
    borderColor: state.isFocused ? '#2684ff' : base.borderColor,
    '&:hover': {
      borderColor: '#2684ff',
    },
  }),

  valueContainer: (base) => ({
    ...base,
    padding: '0 6px',
  }),

  indicatorsContainer: (base) => ({
    ...base,
    height: 28,
  }),
  dropdownIndicator: (base) => ({
    ...base,
    padding: '0 4px',
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: '0 4px',
  }),

  // 👇 ellipsis in the selected value
  singleValue: (base) => ({
    ...base,
    color: 'black',
    maxWidth: '100%',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),

  input: (base) => ({
    ...base,
    color: 'black',
    margin: 0,
    padding: 0,
  }),

  placeholder: (base) => ({
    ...base,
    fontSize: 12,
  }),

  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({
    ...base,
    overflowY: 'auto',
    fontSize: 12,
  }),
  menuList: (base) => ({
    ...base,
    paddingTop: 0,
    paddingBottom: 0,
  }),

  // 👇 ellipsis in each option (menu item)
  option: (base, state) => ({
    ...base,
    fontSize: 12,
    padding: '4px 8px',
    width: '100%',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: 'black',
    backgroundColor: state.isFocused
      ? 'rgba(38, 132, 255, 0.1)'
      : state.isSelected
      ? '#2684ff'
      : base.backgroundColor,
  }),
});


const SelectComponent = ({ 
  optionsList,
  onChangeHandler, 
  value,
  width = 150,
}) => {
  const handleChange = useCallback((option) => {
    onChangeHandler([option]);
  }, [onChangeHandler]);

  return (
    <Select
      components={{ MenuList }}
      styles={customStyles(width)}
      filterOption={createFilter({ ignoreAccents: false })}
      options={optionsList}
      value={value}
      onChange={handleChange}
      menuPortalTarget={document.body}
      menuShouldScrollIntoView={false}
      menuPosition="fixed"
    />
  );
};

export default SelectComponent;
