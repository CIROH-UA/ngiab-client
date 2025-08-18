import React,{ Component,useCallback } from 'react';
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
        height={adjustedHeight} // Use the adjusted height
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
  menu: (provided) => ({
    ...provided,
    backgroundColor: '#4f5b67',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isFocused 
        ? 'rgba(255, 255, 255, 0.1)' 
        : 'transparent',
    color:  '#ffffff',
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
  
// Usage of the Select component with the custom Option component
const SelectComponent = ({ optionsList, onChangeHandler,defaultValue }) => {
 // Handler for when an option is selected, wrapped in useCallback
 const handleChange = useCallback((option) => {
  onChangeHandler(`${option.value}`)
  }, [onChangeHandler]);
  // const handleChange = (option) =>{
  //   onChangeHandler(`${option.value}`)
  // }

  return (
    <Select
      components={{ MenuList }}
      styles={customStyles}
      filterOption={createFilter({ ignoreAccents: false })}
      options={optionsList}
      onChange={handleChange}
      value={defaultValue}
      menuPortalTarget={document.body} // Ensure menu renders outside container if needed
      menuShouldScrollIntoView={false} // Prevents auto-scrolling issues
      menuPosition="fixed" // Keeps the dropdown position fixed
    />
  );
};

export default SelectComponent;