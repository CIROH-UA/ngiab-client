import os
import json
import pandas as pd
import glob


def _get_base_troute_output(app_workspace):
    base_output_path = os.path.join(
        app_workspace.path, "ngen-data", "outputs", "troute"
    )
    return base_output_path


def get_troute_df(app_workspace):
    base_output_path = _get_base_troute_output(app_workspace)
    troute_output_files = glob.glob(base_output_path + "/*.csv")
    df = pd.read_csv(troute_output_files[0])
    return df


def check_troute_id(df, id):
    if int(id) in df["featureID"].values:
        return True
    return False


def get_troute_vars(df):
    list_variables = df.columns.tolist()[3:]  # remove feature, time and t0

    variables = [
        {"value": variable, "label": variable.lower()} for variable in list_variables
    ]
    return variables


def get_base_output(app_workspace):
    output_relative_path = get_output_path(app_workspace).split("outputs")[-1]
    base_output_path = os.path.join(
        app_workspace.path, "ngen-data", "outputs", output_relative_path.strip("/")
    )
    return base_output_path


def get_output_path(app_workspace):
    """
    Retrieve the value of the 'output_root' key from a JSON file.

    Args:
    json_filepath (str): The file path of the JSON file.

    Returns:
    str: The value of the 'output_root' key or None if the key doesn't exist.
    """
    realizations_output_path = os.path.join(
        app_workspace.path, "ngen-data", "config", "realization.json"
    )

    try:
        with open(realizations_output_path, "r") as file:
            data = json.load(file)
        return data.get("output_root", None)
    except FileNotFoundError:
        print(f"Error: The file {realizations_output_path} does not exist.")
        return None
    except json.JSONDecodeError:
        print("Error: Failed to decode JSON.")
        return None
    except Exception as e:
        print(f"An error occurred: {e}")
        return None


def _list_prefixed_csv_files(directory, prefix):
    """
    List all CSV files in a specified directory that start with a given prefix.

    Args:
    directory (str): The directory to search for files.
    prefix (str): The prefix the file names should start with.

    Returns:
    list: A list of filenames (str) that match the criteria.
    """
    # Check if the directory exists
    if not os.path.exists(directory):
        print("The specified directory does not exist.")
        return []

    # List all files in the directory
    files = os.listdir(directory)

    # Filter files to find those that are CSVs and start with the given prefix
    csv_files = [
        file for file in files if file.startswith(prefix) and file.endswith(".csv")
    ]

    return csv_files


def getCatchmentsIds(app_workspace):
    """
    Get a list of catchment IDs.

    Parameters:
        app_workspace (str): The path to the application workspace.

    Returns:
        list: A list of dictionaries containing catchment IDs and labels.
              Each dictionary has the keys 'value' and 'label'.
    """
    output_base_file = get_base_output(app_workspace)
    catchment_prefix = "cat-"
    catchment_ids_list = _list_prefixed_csv_files(output_base_file, catchment_prefix)
    return [
        {"value": id.split(".csv")[0], "label": id.split(".csv")[0]}
        for id in catchment_ids_list
    ]


def getNexusIDs(app_workspace):
    """
    Get a list of Nexus IDs.

    Parameters:
        app_workspace (str): The path to the application workspace.

    Returns:
        list: A list of dictionaries containing the Nexus IDs. Each dictionary has a 'value' and 'label' key.
    """
    output_base_file = get_base_output(app_workspace)
    nexus_prefix = "nex-"
    nexus_ids_list = _list_prefixed_csv_files(output_base_file, nexus_prefix)
    return [
        {"value": id.split("_output.csv")[0], "label": id.split("_output.csv")[0]}
        for id in nexus_ids_list
    ]
