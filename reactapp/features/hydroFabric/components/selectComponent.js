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
  // menu: (provided) => ({
  //   ...provided,
  //   maxHeight: '500px', // Adjust dropdown height here
  //   overflowY: 'auto',
  // }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  option: (provided) => ({
    ...provided,
    color: 'black',
    overflowY: 'auto',
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