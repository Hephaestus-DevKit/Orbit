cmake_minimum_required(VERSION 3.20)
project(orbit_windows_sandbox_helper LANGUAGES CXX)

add_executable(orbit-windows-sandbox-helper main.cpp)
target_compile_features(orbit-windows-sandbox-helper PRIVATE cxx_std_17)
target_compile_definitions(orbit-windows-sandbox-helper PRIVATE UNICODE _UNICODE NOMINMAX)
target_link_libraries(orbit-windows-sandbox-helper PRIVATE Userenv Advapi32 Shell32)
if (MSVC)
  target_compile_options(orbit-windows-sandbox-helper PRIVATE /W4 /WX /permissive-)
else()
  target_compile_options(orbit-windows-sandbox-helper PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

enable_testing()
add_test(
  NAME rejects_invalid_protocol
  COMMAND orbit-windows-sandbox-helper --orbit-sandbox-protocol 2
)
set_tests_properties(rejects_invalid_protocol PROPERTIES WILL_FAIL TRUE)

add_test(
  NAME rejects_missing_command
  COMMAND orbit-windows-sandbox-helper
    --orbit-sandbox-protocol 1
    --cwd "${CMAKE_BINARY_DIR}"
    --network deny
)
set_tests_properties(rejects_missing_command PROPERTIES WILL_FAIL TRUE)

add_test(
  NAME rejects_relative_executable
  COMMAND orbit-windows-sandbox-helper
    --orbit-sandbox-protocol 1
    --cwd "${CMAKE_BINARY_DIR}"
    --network deny
    -- cmd.exe /c exit 0
)
set_tests_properties(rejects_relative_executable PROPERTIES WILL_FAIL TRUE)
