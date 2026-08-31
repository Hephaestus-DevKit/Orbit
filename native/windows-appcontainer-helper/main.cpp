#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <userenv.h>

#include <algorithm>
#include <cwctype>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct Options {
  std::wstring cwd;
  std::wstring network;
  std::vector<std::wstring> read_only;
  std::vector<std::wstring> writable;
  std::vector<std::wstring> command;
};

struct AclBackup {
  std::wstring path;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PACL original_dacl = nullptr;
  bool changed = false;
};

struct SandboxIdentity {
  std::wstring profile_name;
  PSID sid = nullptr;
};

[[noreturn]] void fail(const std::wstring &message, DWORD error = ERROR_INVALID_PARAMETER) {
  const int byte_count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, message.data(),
                                              static_cast<int>(message.size()), nullptr, 0,
                                              nullptr, nullptr);
  std::string narrow;
  if (byte_count > 0) {
    narrow.resize(static_cast<size_t>(byte_count));
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, message.data(),
                        static_cast<int>(message.size()), narrow.data(), byte_count,
                        nullptr, nullptr);
  } else {
    narrow = "Windows sandbox helper failure";
  }
  if (error != ERROR_SUCCESS) narrow += " (win32=" + std::to_string(error) + ")";
  throw std::runtime_error(narrow);
}

bool is_absolute(const std::wstring &path) {
  return path.size() >= 3 && std::iswalpha(path[0]) && path[1] == L':' &&
         (path[2] == L'\\' || path[2] == L'/');
}

std::wstring full_path(const std::wstring &path) {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetFullPathNameW(path.c_str(), static_cast<DWORD>(buffer.size()),
                                        buffer.data(), nullptr);
  if (length == 0 || length >= buffer.size()) fail(L"cannot resolve an absolute path", GetLastError());
  return std::wstring(buffer.data(), length);
}

std::wstring normalize_for_compare(std::wstring value) {
  std::replace(value.begin(), value.end(), L'/', L'\\');
  while (value.size() > 3 && value.back() == L'\\') value.pop_back();
  std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return std::towlower(c); });
  return value;
}

bool inside(const std::wstring &root, const std::wstring &candidate) {
  const auto a = normalize_for_compare(root);
  const auto b = normalize_for_compare(candidate);
  return a == b ||
         (b.size() > a.size() && b.compare(0, a.size(), a) == 0 &&
          b[a.size()] == L'\\');
}

bool directory_exists(const std::wstring &path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

bool regular_file_exists(const std::wstring &path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

void reject_reparse_components(const std::wstring &path) {
  std::wstring current = path.substr(0, 3);
  size_t offset = 3;
  while (offset < path.size()) {
    while (offset < path.size() && (path[offset] == L'\\' || path[offset] == L'/')) ++offset;
    if (offset >= path.size()) break;
    const size_t end = path.find_first_of(L"\\/", offset);
    const size_t length = end == std::wstring::npos ? path.size() - offset : end - offset;
    current.append(path, offset, length);
    const DWORD attributes = GetFileAttributesW(current.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES &&
        (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
      fail(L"sandbox paths may not contain reparse points");
    }
    if (end == std::wstring::npos) break;
    current.push_back(L'\\');
    offset = end + 1;
  }
}

Options parse_options(int argc, wchar_t **argv) {
  Options options;
  bool command_started = false;
  for (int index = 1; index < argc; ++index) {
    const std::wstring argument(argv[index]);
    if (command_started) {
      options.command.push_back(argument);
      continue;
    }
    if (argument == L"--") {
      command_started = true;
    } else if (argument == L"--orbit-sandbox-protocol" && index + 1 < argc &&
               std::wstring(argv[++index]) == L"1") {
      // Protocol version is intentionally explicit.
    } else if (argument == L"--cwd" && index + 1 < argc) {
      options.cwd = argv[++index];
    } else if (argument == L"--network" && index + 1 < argc) {
      options.network = argv[++index];
    } else if (argument == L"--read-only" && index + 1 < argc) {
      options.read_only.emplace_back(argv[++index]);
    } else if (argument == L"--writable" && index + 1 < argc) {
      options.writable.emplace_back(argv[++index]);
    } else {
      fail(L"invalid structured argument");
    }
  }
  if (options.cwd.empty() || options.command.empty() || options.network.empty() ||
      (options.network != L"inherit" && options.network != L"deny" && options.network != L"allow")) {
    fail(L"protocol, cwd, network, and a command are required");
  }
  return options;
}

void validate_paths(Options &options) {
  if (!is_absolute(options.cwd)) fail(L"cwd must be an absolute Windows path");
  options.cwd = full_path(options.cwd);
  if (!directory_exists(options.cwd)) fail(L"cwd is not an existing directory");
  reject_reparse_components(options.cwd);
  auto validate = [&](std::vector<std::wstring> &paths) {
    for (auto &path : paths) {
      if (!is_absolute(path)) fail(L"sandbox roots must be absolute Windows paths");
      path = full_path(path);
      if (!directory_exists(path)) fail(L"sandbox root is not a directory");
      reject_reparse_components(path);
    }
  };
  validate(options.read_only);
  validate(options.writable);
  for (const auto *roots : {&options.read_only, &options.writable}) {
    for (size_t left = 0; left < roots->size(); ++left) {
      for (size_t right = left + 1; right < roots->size(); ++right) {
        if (normalize_for_compare((*roots)[left]) == normalize_for_compare((*roots)[right])) {
          fail(L"sandbox roots contain a duplicate path");
        }
      }
    }
  }
  for (const auto &read_only : options.read_only) {
    for (const auto &writable : options.writable) {
      if (inside(read_only, writable) || inside(writable, read_only)) fail(L"sandbox roots overlap with conflicting permissions");
    }
  }
  if (options.command.empty() || !is_absolute(options.command.front())) {
    fail(L"the executable must be an absolute Windows path");
  }
  options.command.front() = full_path(options.command.front());
  if (!regular_file_exists(options.command.front())) {
    fail(L"the executable is not an existing regular file");
  }
  reject_reparse_components(options.command.front());
}

std::wstring quote_argument(const std::wstring &argument) {
  std::wstring result = L"\"";
  size_t backslashes = 0;
  for (wchar_t character : argument) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'\"') {
      result.append(backslashes * 2 + 1, L'\\');
      result.push_back(L'\"');
      backslashes = 0;
      continue;
    }
    result.append(backslashes, L'\\');
    backslashes = 0;
    result.push_back(character);
  }
  result.append(backslashes * 2, L'\\');
  result.push_back(L'\"');
  return result;
}

std::wstring command_line(const std::vector<std::wstring> &command) {
  std::wstring result;
  for (const auto &argument : command) {
    if (!result.empty()) result.push_back(L' ');
    result += quote_argument(argument);
  }
  return result;
}

SandboxIdentity create_appcontainer_sid() {
  const std::wstring profile_name =
      L"Orbit.ProcessSandbox." + std::to_wstring(GetCurrentProcessId()) +
      L"." + std::to_wstring(GetTickCount64());
  PSID sid = nullptr;
  const HRESULT created = CreateAppContainerProfile(
      profile_name.c_str(), L"Orbit Process Sandbox",
      L"Per-run Orbit process isolation", nullptr, 0, &sid);
  if (SUCCEEDED(created)) return {profile_name, sid};
  if (created != HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) {
    fail(L"cannot create an AppContainer profile", HRESULT_CODE(created));
  }
  const HRESULT derived =
      DeriveAppContainerSidFromAppContainerName(profile_name.c_str(), &sid);
  if (FAILED(derived)) {
    fail(L"cannot derive an existing AppContainer profile",
         HRESULT_CODE(derived));
  }
  return {profile_name, sid};
}

void add_acl(AclBackup &backup, PSID appcontainer_sid, DWORD permissions) {
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PACL dacl = nullptr;
  DWORD result = GetNamedSecurityInfoW(backup.path.c_str(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
                                       nullptr, nullptr, &dacl, nullptr, &descriptor);
  if (result != ERROR_SUCCESS) fail(L"cannot read sandbox root ACL", result);
  backup.descriptor = descriptor;
  backup.original_dacl = dacl;
  EXPLICIT_ACCESSW access{};
  access.grfAccessPermissions = permissions;
  access.grfAccessMode = GRANT_ACCESS;
  access.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT | OBJECT_INHERIT_ACE;
  access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  access.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  access.Trustee.ptstrName = reinterpret_cast<LPWSTR>(appcontainer_sid);
  PACL updated = nullptr;
  result = SetEntriesInAclW(1, &access, dacl, &updated);
  if (result != ERROR_SUCCESS) fail(L"cannot prepare sandbox root ACL", result);
  result = SetNamedSecurityInfoW(backup.path.data(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
                                 nullptr, nullptr, updated, nullptr);
  LocalFree(updated);
  if (result != ERROR_SUCCESS) fail(L"cannot apply sandbox root ACL", result);
  backup.changed = true;
}

DWORD restore_acl(AclBackup &backup) {
  DWORD result = ERROR_SUCCESS;
  if (backup.changed && backup.descriptor != nullptr) {
    result = SetNamedSecurityInfoW(backup.path.data(), SE_FILE_OBJECT,
                                   DACL_SECURITY_INFORMATION, nullptr, nullptr,
                                   backup.original_dacl, nullptr);
  }
  LocalFree(backup.descriptor);
  backup.descriptor = nullptr;
  backup.changed = false;
  return result;
}

struct SecurityCapabilities {
  std::vector<PSID> capability_sids;
  std::vector<SID_AND_ATTRIBUTES> capabilities;
  SECURITY_CAPABILITIES value{};

  SecurityCapabilities(PSID appcontainer_sid, const std::wstring &network) {
    value.AppContainerSid = appcontainer_sid;
    value.Capabilities = nullptr;
    value.CapabilityCount = 0;
    value.Reserved = 0;
    if (network == L"deny") return;

    PSID internet = nullptr;
    if (!ConvertStringSidToSidW(L"S-1-15-3-1", &internet)) {
      fail(L"cannot create Internet Client capability SID", GetLastError());
    }
    capability_sids.push_back(internet);
    capabilities.push_back({internet, 0});
    value.Capabilities = capabilities.data();
    value.CapabilityCount = static_cast<DWORD>(capabilities.size());
  }

  ~SecurityCapabilities() {
    for (PSID sid : capability_sids) LocalFree(sid);
  }
};

int run_process(const Options &options, PSID appcontainer_sid) {
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (job == nullptr) fail(L"cannot create process job", GetLastError());
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    const DWORD error = GetLastError();
    CloseHandle(job);
    fail(L"cannot configure process job", error);
  }

  SecurityCapabilities capabilities(appcontainer_sid, options.network);
  SIZE_T attribute_list_bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attribute_list_bytes);
  if (attribute_list_bytes == 0) {
    const DWORD error = GetLastError();
    CloseHandle(job);
    fail(L"cannot size the process attribute list", error);
  }
  std::vector<BYTE> attribute_storage(attribute_list_bytes);
  auto *attribute_list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attribute_storage.data());
  if (!InitializeProcThreadAttributeList(attribute_list, 1, 0, &attribute_list_bytes)) {
    const DWORD error = GetLastError();
    CloseHandle(job);
    fail(L"cannot initialize the process attribute list", error);
  }
  const auto cleanup_attributes = [&]() { DeleteProcThreadAttributeList(attribute_list); };
  if (!UpdateProcThreadAttribute(attribute_list, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                                 &capabilities.value, sizeof(capabilities.value), nullptr, nullptr)) {
    const DWORD error = GetLastError();
    cleanup_attributes();
    CloseHandle(job);
    fail(L"cannot configure AppContainer security capabilities", error);
  }

  std::wstring command = command_line(options.command);
  std::vector<wchar_t> mutable_command(command.begin(), command.end());
  mutable_command.push_back(L'\0');
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.lpAttributeList = attribute_list;
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, FALSE,
                      EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT |
                          CREATE_SUSPENDED,
                      nullptr, options.cwd.c_str(), &startup.StartupInfo, &process)) {
    const DWORD error = GetLastError();
    cleanup_attributes();
    CloseHandle(job);
    fail(L"cannot create AppContainer process", error);
  }
  cleanup_attributes();
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    const DWORD error = GetLastError();
    TerminateProcess(process.hProcess, 1);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    fail(L"cannot assign process to kill-on-close job", error);
  }
  if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
    const DWORD error = GetLastError();
    TerminateProcess(process.hProcess, 1);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    fail(L"cannot resume AppContainer process", error);
  }
  const DWORD wait_result = WaitForSingleObject(process.hProcess, INFINITE);
  if (wait_result != WAIT_OBJECT_0) {
    const DWORD error = GetLastError();
    TerminateProcess(process.hProcess, 1);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    fail(L"cannot wait for AppContainer process", error);
  }
  DWORD exit_code = 1;
  if (!GetExitCodeProcess(process.hProcess, &exit_code)) {
    const DWORD error = GetLastError();
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    fail(L"cannot read AppContainer process exit code", error);
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  CloseHandle(job);
  return static_cast<int>(exit_code & 0xff);
}

int run_sandbox(const Options &options) {
  SandboxIdentity identity = create_appcontainer_sid();
  std::vector<AclBackup> backups;
  for (const auto &path : options.read_only) backups.push_back({path});
  for (const auto &path : options.writable) backups.push_back({path});

  int exit_code = 1;
  std::exception_ptr execution_failure;
  try {
    for (size_t index = 0; index < options.read_only.size(); ++index) {
      add_acl(backups[index], identity.sid, GENERIC_READ);
    }
    for (size_t index = 0; index < options.writable.size(); ++index) {
      add_acl(backups[options.read_only.size() + index], identity.sid,
              GENERIC_READ | GENERIC_WRITE | DELETE);
    }
    exit_code = run_process(options, identity.sid);
  } catch (...) {
    execution_failure = std::current_exception();
  }

  DWORD restore_error = ERROR_SUCCESS;
  for (auto &backup : backups) {
    const DWORD result = restore_acl(backup);
    if (restore_error == ERROR_SUCCESS && result != ERROR_SUCCESS) {
      restore_error = result;
    }
  }
  const HRESULT delete_result = DeleteAppContainerProfile(identity.profile_name.c_str());
  FreeSid(identity.sid);

  if (restore_error != ERROR_SUCCESS) {
    fail(L"cannot restore a sandbox root ACL", restore_error);
  }
  if (FAILED(delete_result)) {
    fail(L"cannot delete the per-run AppContainer profile", HRESULT_CODE(delete_result));
  }
  if (execution_failure) std::rethrow_exception(execution_failure);
  return exit_code;
}

}  // namespace

int wmain(int argc, wchar_t **argv) {
  try {
    if (argc < 2) fail(L"no structured arguments supplied");
    Options options = parse_options(argc, argv);
    validate_paths(options);
    return run_sandbox(options);
  } catch (const std::exception &error) {
    std::cerr << "orbit-windows-sandbox-helper: " << error.what() << "\n";
    return 1;
  }
}
