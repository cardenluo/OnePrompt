

from .file_renameWay import *
from .zip_file_processor import *
from .csv_file_processor import *

NODE_CLASS_MAPPINGS = {
    "file_CSVMapReader": file_CSVMapReader,
    "file_XLSXMapReader": file_XLSXMapReader,
    "file_MapRenamer": file_MapRenamer,
    "file_Rename_ByList": file_Rename_ByList,

    "file_Organizer": file_Organizer,
    "file_AnyFileToZip": file_AnyFileToZip,
    "file_LoadAnyFileList": file_LoadAnyFileList,
    "file_LoadZipFile": file_LoadZipFile,
    "file_Split_FileInfo": file_Split_FileInfo,
    "file_AutoIndex_Rename": file_AutoIndex_Rename,
    "file_FileInfo_Merge_Single": file_FileInfo_Merge_Single,
    "file_FileInfo_Merge_mul": file_FileInfo_Merge_mul,
    "csv_write_data":csv_write_data,
    "csv_read":csv_read,
    "csv_Std_Processor": csv_Std_Processor,


}


NODE_DISPLAY_NAME_MAPPINGS = {


}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']

