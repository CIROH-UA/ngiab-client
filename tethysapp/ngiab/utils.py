import os
import json
import pandas as pd
import glob
import duckdb
from datetime import datetime


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


def get_base_teehr_path(app_workspace):
    base_output_teehr_path = os.path.join(app_workspace.path, "ngen-data", "teehr")
    return base_output_teehr_path


def get_usgs_from_ngen(app_workspace, ngen_id):
    base_output_teehr_path = get_base_teehr_path(app_workspace)
    # Define the path to the ngen_usgs_crosswalk.parquet file
    crosswalk_file_path = os.path.join(
        base_output_teehr_path, "ngen_usgs_crosswalk.parquet"
    )

    # Query the parquet file with DuckDB
    query = f"""
        SELECT primary_location_id
        FROM '{crosswalk_file_path}'
        WHERE secondary_location_id = '{ngen_id}'
        LIMIT 1;
    """
    try:
        # Execute query and fetch result
        result = duckdb.query(query).fetchone()
        # If a result was found, return the primary_location_id, otherwise None
        return result[0] if result else None
    except Exception as e:
        print(f"Error querying ngen_usgs_crosswalk.parquet: {e}")
        return None


def append_ngen_usgs_column(gdf, app_workspace):
    # Load ngen_usgs_crosswalk.parquet into DuckDB
    base_output_teehr_path = get_base_teehr_path(app_workspace)
    # Define the path to the ngen_usgs_crosswalk.parquet file
    ngen_usgs_crosswalk_path = os.path.join(
        base_output_teehr_path, "ngen_usgs_crosswalk.parquet"
    )

    # Query the data from DuckDB
    query = f"""
        SELECT secondary_location_id, primary_location_id
        FROM '{ngen_usgs_crosswalk_path}'
    """
    ngen_usgs_df = duckdb.query(query).to_df()

    # Create a dictionary for fast lookup, replacing 'ngen' with 'nex' in the keys
    ngen_usgs_map = {
        sec_id.replace("ngen", "nex"): prim_id
        for sec_id, prim_id in zip(
            ngen_usgs_df["secondary_location_id"], ngen_usgs_df["primary_location_id"]
        )
    }

    # Append ngen_usgs column to the GeoDataFrame
    gdf["ngen_usgs"] = gdf["id"].apply(lambda x: ngen_usgs_map.get(x, "none"))

    return gdf


def append_nwm_usgs_column(gdf, app_workspace):
    # Load nwm_usgs_crosswalk.parquet into DuckDB
    base_output_teehr_path = get_base_teehr_path(app_workspace)
    # Define the path to the ngen_usgs_crosswalk.parquet file
    nwm_usgs_crosswalk_path = os.path.join(
        base_output_teehr_path, "nwm_usgs_crosswalk.parquet"
    )

    query = f"""
        SELECT primary_location_id, secondary_location_id
        FROM '{nwm_usgs_crosswalk_path}'
    """
    nwm_usgs_df = duckdb.query(query).to_df()

    # Create a dictionary for fast lookup
    nwm_usgs_map = dict(
        zip(
            nwm_usgs_df["primary_location_id"],
            nwm_usgs_df["secondary_location_id"],
        )
    )

    # Append nwm_usgs column to the GeoDataFrame
    gdf["nwm_usgs"] = gdf["ngen_usgs"].apply(lambda x: nwm_usgs_map.get(x, "none"))
    return gdf


def get_configuration_variable_pairs(app_workspace):
    base_output_teehr_path = get_base_teehr_path(app_workspace)
    joined_timeseries_base_path = os.path.join(
        base_output_teehr_path, "dataset", "joined_timeseries"
    )
    configurations_variables = []

    # Traverse the directory tree from the base path
    for root, dirs, files in os.walk(joined_timeseries_base_path):
        # Check if the directory matches the `configuration_name=` pattern
        if "configuration_name=" in root:
            # Extract the configuration name from the directory path
            config_name = [
                d.split("=")[1]
                for d in root.split("/")
                if d.startswith("configuration_name=")
            ][0]

            # Look one level deeper for `variable_name=` directories
            for dir_name in dirs:
                if dir_name.startswith("variable_name="):
                    variable_name = dir_name.split("=")[1]

                    # Create the dictionary with value and label
                    config_var_pair = {
                        "value": f"{config_name}-{variable_name}",
                        "label": f"{config_name} {variable_name.replace('_', ' ')}",
                    }
                    configurations_variables.append(config_var_pair)

    return configurations_variables


def get_teehr_joined_ts_path(app_workspace, configuration, variable):
    base_output_teehr_path = get_base_teehr_path(app_workspace)
    joined_timeseries_path = os.path.join(
        base_output_teehr_path, "dataset", "joined_timeseries"
    )
    # Build the target path
    target_path = os.path.join(
        joined_timeseries_path,
        f"configuration_name={configuration}",
        f"variable_name={variable}",
    )

    # Find the parquet file in the target directory
    parquet_files = glob.glob(os.path.join(target_path, "*.parquet"))

    # Return the parquet file path if found, otherwise return None
    if parquet_files:
        return parquet_files[0]  # Assuming there is only one parquet file
    else:
        return None


def get_usgs_from_ngen_id(app_workspace, nexgen_id):
    base_output_teehr_path = get_base_teehr_path(app_workspace)
    negen_usgs_path = os.path.join(
        base_output_teehr_path, "ngen_usgs_crosswalk.parquet"
    )
    # Open DuckDB connection
    corrected_next_id = nexgen_id.replace("nex", "ngen")
    conn = duckdb.connect(database=":memory:")

    # Load and filter the parquet file based on the primary_location_id value
    query = f"""
        SELECT primary_location_id, secondary_location_id
        FROM parquet_scan('{negen_usgs_path}')
        WHERE secondary_location_id = '{corrected_next_id}'
    """
    df = conn.execute(query).fetchdf()
    conn.close()
    if df.empty:
        return None
    return df["primary_location_id"].values[0]


def get_teehr_ts(parquet_file_path, primary_location_id_value, teehr_configuration):
    # Open DuckDB connection
    conn = duckdb.connect(database=":memory:")

    # Load and filter the parquet file based on the primary_location_id value
    query = f"""
        SELECT value_time, primary_value, secondary_value
        FROM parquet_scan('{parquet_file_path}')
        WHERE primary_location_id = '{primary_location_id_value}'
        ORDER BY value_time
    """
    filtered_df = conn.execute(query).fetchdf()

    # Close DuckDB connection
    conn.close()

    # Convert datetime format
    filtered_df["value_time"] = filtered_df["value_time"].apply(
        lambda x: x.strftime("%Y-%m-%d %H:%M:%S")
    )

    primary_data = [
        {"x": row["value_time"], "y": row["primary_value"]}
        for _, row in filtered_df.iterrows()
    ]

    secondary_data = [
        {"x": row["value_time"], "y": row["secondary_value"]}
        for _, row in filtered_df.iterrows()
    ]

    series = [
        {"label": "USGS", "data": primary_data},
        {
            "label": f"{teehr_configuration.replace('_', ' ').title()}",
            "data": secondary_data,
        },
    ]

    return series


def get_teehr_metrics(app_workspace, primary_location_id):
    base_output_teehr_path = get_base_teehr_path(app_workspace)
    metrics_path = os.path.join(base_output_teehr_path, "metrics.csv")

    # Load the CSV file
    df = pd.read_csv(metrics_path)

    # Filter the DataFrame by primary_location_id
    df_filtered = df[df["primary_location_id"] == primary_location_id]

    # Pivot the DataFrame to make configuration names the columns
    pivot_df = df_filtered.pivot(
        index="primary_location_id", columns="configuration_name"
    )

    # Flatten the MultiIndex columns
    pivot_df.columns = [f"{metric}_{config}" for metric, config in pivot_df.columns]

    # Extract metrics into the required structure
    metrics_data = [
        {
            "metric": "kling_gupta_efficiency",
            "ngen": pivot_df["kling_gupta_efficiency_ngen"].values[0],
            "nwm30_retrospective": pivot_df[
                "kling_gupta_efficiency_nwm30_retrospective"
            ].values[0],
        },
        {
            "metric": "nash_sutcliffe_efficiency",
            "ngen": pivot_df["nash_sutcliffe_efficiency_ngen"].values[0],
            "nwm30_retrospective": pivot_df[
                "nash_sutcliffe_efficiency_nwm30_retrospective"
            ].values[0],
        },
        {
            "metric": "relative_bias",
            "ngen": pivot_df["relative_bias_ngen"].values[0],
            "nwm30_retrospective": pivot_df["relative_bias_nwm30_retrospective"].values[
                0
            ],
        },
    ]

    return metrics_data
