<!doctype html>
<html>
	<head>
		<meta charset='utf-8'>
		<meta name='viewport' content='width=device-width, initial-scale=1'>
		<style>
html {
	height: 100%;
}

body {
	margin: auto;
	height: 100%;
	display: flex;
	flex-direction: column;
	font-family: Arial;
	font-size: 15px;
}

.search {
	margin: auto;
	width: 65%;
	height: 50px;
	display: flex;
}

.search * {
	border-radius: 5px;
	border: 1px solid #CCC;
	padding: 0px 10px;
	outline: none;
}

.search input[type='text'] {
	width: 100%;
	border-top-right-radius: 0px;
	border-bottom-right-radius: 0px;
	border-right: none;
	color: #555;
}

.search input[type='submit'] {
	background: #0078D4;
	border-top-left-radius: 0px;
	border-bottom-left-radius: 0px;
	color: #FFF;
}

.search input[type='submit']:hover {
	background: #006CBE;
}

.search input[type='submit']:active {
	background: #1683D8;
}

a {
	color: #1A0DAB;
	text-decoration: none;
}

a:hover {
	text-decoration: underline;
}

footer {
	display: block;
	width: 100%;
	text-align: center;
}
		</style>
	</head>
	<body>
		<form class='search' action='/gateway' method='POST'>
			<input name='url' list='presets' type='text' autocomplete='off' placeholder='Enter a URL' required></input>
			
			<input type='submit' value='Visit'></input>
			
			<datalist id='presets'>
				<option value='example.com'></option>
				<option value='google.com'></option>
				<option value='youtube.com'></option>
				<option value='discord.com'></option>
				<option value='1v1.lol'></option>
				<option value='sys32.dev'></option>
			 </datalist>
		</form>
		
		<footer>
			<p><a href='https://github.com/sysce/proxy'>Source code</a></p>
		</footer>
	</body>
</html>