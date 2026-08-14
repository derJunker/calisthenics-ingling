<?php
header('Content-Type: application/json; charset=utf-8');
$weather_data = array("Monday" => 35);
echo json_encode($weather_data, JSON_THROW_ON_ERROR);