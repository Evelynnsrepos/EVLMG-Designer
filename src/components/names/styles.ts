/**
 * Real-world name styles (v0.13): common first names and family names per language or country.
 * The generator mixes them, or makes up new names that sound like them (a letter-chain model
 * trained on the lists), so "German-sounding" or "Polish-sounding" names come out.
 */

export interface NameStyle {
  name: string
  /** Space-separated, mixed genders. */
  first: string
  last: string
  /** Family name first (East Asian, Hungarian). */
  lastFirst?: boolean
}

export const NAME_STYLES: NameStyle[] = [
  { name: 'English (British)', first: 'Oliver Harry George Jack Charlie Thomas James William Henry Arthur Alfie Edward Amelia Olivia Isla Ava Emily Sophie Grace Poppy Lily Ruby Evie Alice Florence Charlotte', last: 'Smith Jones Taylor Brown Williams Wilson Johnson Davies Robinson Wright Thompson Evans Walker White Roberts Green Hall Wood Jackson Clarke Hughes Edwards Turner Harris Cooper' },
  { name: 'American', first: 'Liam Noah Mason Ethan Logan Lucas Jackson Aiden Carter Wyatt Hunter Tyler Brandon Madison Emma Ava Abigail Harper Avery Chloe Brooklyn Kayla Ashley Taylor Savannah', last: 'Smith Johnson Williams Brown Jones Miller Davis Garcia Wilson Anderson Thomas Moore Martin Jackson Thompson White Harris Clark Lewis Walker Young Allen King Wright Scott' },
  { name: 'Canadian', first: 'Liam Noah Lucas William Benjamin Logan Jacob Nathan Olivier Félix Gabriel Mathis Emma Olivia Charlotte Chloé Léa Alice Florence Maeve Brooklyn Hailey Madison Avery Juliette', last: 'Smith Brown Tremblay Martin Roy Wilson MacDonald Gagnon Johnson Taylor Côté Campbell Anderson Leblanc Lee Bouchard Gauthier Morin Fraser Stewart Thompson Lavoie Robertson Bélanger Pelletier' },
  { name: 'Australian', first: 'Oliver Jack William Noah Thomas Lachlan Cooper Riley Harrison Mitchell Jaxon Bailey Charlotte Olivia Mia Isla Matilda Ruby Chloe Sienna Zoe Jessica Brooke Tahlia Kirra', last: 'Smith Jones Williams Brown Wilson Taylor Johnson White Martin Anderson Thompson Nguyen Thomas Walker Harris Lee Ryan Robinson Kelly King Davies Wright Evans Murphy Mitchell' },
  { name: 'Irish', first: 'Seán Conor Cian Darragh Oisín Fionn Liam Ciarán Eoin Pádraig Ronan Colm Aoife Saoirse Niamh Siobhán Róisín Caoimhe Clodagh Orla Ciara Sinéad Aisling Gráinne Méabh', last: "Murphy Kelly O'Sullivan Walsh O'Brien Byrne Ryan O'Connor O'Neill O'Reilly Doyle McCarthy Gallagher O'Doherty Kennedy Lynch Murray Quinn Moore McLoughlin Brennan Fitzgerald Dunne Kavanagh Nolan" },
  { name: 'Scottish', first: 'Callum Hamish Angus Fraser Lachlan Ewan Alasdair Iain Ruaridh Finlay Murdo Duncan Isla Eilidh Morag Fiona Kirsty Catriona Ailsa Iona Mhairi Shona Kirsteen Elspeth Rhona', last: 'MacDonald Campbell Stewart Robertson Murray MacLeod Fraser Mackenzie Ross Gordon Grant Cameron Sinclair Douglas Buchanan Munro Mackay Ferguson Wallace Kerr Hamilton Drummond Lindsay Graham Forbes' },
  { name: 'Welsh', first: 'Dafydd Rhys Gareth Ieuan Owain Gruffudd Huw Emyr Aled Dylan Iolo Cai Seren Cerys Angharad Ffion Bethan Nia Gwen Rhiannon Eirlys Megan Lowri Mali Catrin', last: 'Jones Williams Davies Evans Thomas Roberts Lewis Hughes Morgan Griffiths Edwards Owen Price Pritchard Lloyd Rees Jenkins Parry Powell Bevan Howells Llewellyn Vaughan Prosser Pugh' },
  { name: 'German', first: 'Lukas Leon Finn Jonas Paul Felix Maximilian Niklas Tobias Jannik Stefan Matthias Klaus Mia Hannah Emma Lena Lea Johanna Marie Sophie Katharina Anja Sabine Ursula Greta', last: 'Müller Schmidt Schneider Fischer Weber Meyer Wagner Becker Schulz Hoffmann Schäfer Koch Bauer Richter Klein Wolf Schröder Neumann Schwarz Zimmermann Braun Krüger Hofmann Hartmann Lange' },
  { name: 'Austrian', first: 'Lukas Tobias David Florian Elias Jakob Simon Sebastian Matthias Florentin Andreas Wolfgang Anna Lena Sophie Katharina Theresa Valentina Magdalena Johanna Viktoria Leonie Christina Elisabeth Eva', last: 'Gruber Huber Bauer Wagner Müller Pichler Steiner Moser Mayer Hofer Leitner Berger Fuchs Eder Fischer Schmid Winkler Weber Schwarz Maier Schneider Reiter Mayr Schmidt Wimmer' },
  { name: 'Swiss', first: 'Noah Luca Leon Levin Nico Gian Jonas Matteo Andri Reto Urs Beat Mia Lara Lina Laura Seraina Nina Elena Leonie Mirjam Corinne Fabienne Regula Ladina', last: 'Müller Meier Schmid Keller Weber Huber Schneider Meyer Steiner Fischer Gerber Brunner Baumann Frei Zimmermann Moser Widmer Wyss Graf Roth Bühler Suter Hofstetter Ammann Lüthi' },
  { name: 'Dutch', first: 'Daan Sem Lucas Bram Jesse Thijs Ruben Stijn Joris Pieter Maarten Wouter Emma Julia Sophie Lotte Fenna Sanne Femke Eva Anouk Lieke Floor Noor Marieke', last: 'de Jong Jansen de Vries van den Berg van Dijk Bakker Janssen Visser Smit Meijer de Boer Mulder de Groot Bos Vos Peters Hendriks van Leeuwen Dekker Brouwer de Wit Dijkstra Smits de Graaf' },
  { name: 'Flemish (Belgian)', first: 'Arthur Lucas Louis Wout Jens Pieter Lander Jef Stijn Ruben Thibault Bram Marie Louise Lotte Elise Fien Hanne Lien Eline Nele Ine Sofie Kato Margot', last: 'Peeters Janssens Maes Jacobs Mertens Willems Claes Goossens Wouters De Smet Dubois Vermeulen Van Damme Hermans Aerts Michiels Desmet De Clercq Martens Lambrechts Verhoeven Van Acker Coppens Cools Leemans' },
  { name: 'French', first: 'Gabriel Louis Raphaël Jules Arthur Hugo Léo Mathis Antoine Baptiste Julien Théo Emma Jade Louise Alice Chloé Lina Léa Manon Camille Inès Juliette Margaux Élodie', last: 'Martin Bernard Dubois Thomas Robert Richard Petit Durand Leroy Moreau Simon Laurent Lefebvre Michel Garcia David Bertrand Roux Vincent Fournier Morel Girard André Mercier Dupont' },
  { name: 'Italian', first: 'Leonardo Francesco Alessandro Lorenzo Mattia Andrea Gabriele Riccardo Tommaso Giuseppe Matteo Marco Sofia Giulia Aurora Alice Ginevra Emma Giorgia Beatrice Chiara Francesca Martina Elena Lucia', last: 'Rossi Russo Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti De Luca Mancini Costa Giordano Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi' },
  { name: 'Spanish', first: 'Hugo Martín Lucas Mateo Leo Daniel Alejandro Pablo Manuel Álvaro Javier Diego Lucía Sofía Martina María Julia Paula Valeria Emma Daniela Carmen Elena Alba Inés', last: 'García Rodríguez González Fernández López Martínez Sánchez Pérez Gómez Martín Jiménez Ruiz Hernández Díaz Moreno Muñoz Álvarez Romero Alonso Gutiérrez Navarro Torres Domínguez Vázquez Ramos' },
  { name: 'Mexican', first: 'Santiago Mateo Sebastián Leonardo Emiliano Diego Miguel Ángel Iker Alejandro Rodrigo Joaquín Sofía Valentina Regina Camila Ximena María José Renata Fernanda Guadalupe Daniela Itzel Paola', last: 'Hernández García Martínez López González Pérez Rodríguez Sánchez Ramírez Cruz Flores Gómez Morales Vázquez Reyes Jiménez Torres Díaz Gutiérrez Ruiz Mendoza Aguilar Ortiz Castillo Moreno' },
  { name: 'Brazilian', first: 'Miguel Arthur Heitor Bernardo Davi Théo Lorenzo Gabriel Pedro Benjamin Matheus Lucas Helena Alice Laura Maria Valentina Heloísa Manuela Júlia Sophia Lívia Beatriz Larissa Fernanda', last: 'Silva Santos Oliveira Souza Rodrigues Ferreira Alves Pereira Lima Gomes Costa Ribeiro Martins Carvalho Almeida Lopes Soares Fernandes Vieira Barbosa Rocha Dias Nascimento Andrade Moreira' },
  { name: 'Portuguese', first: 'João Rodrigo Martim Francisco Santiago Tomás Afonso Duarte Gonçalo Rui Nuno Tiago Maria Leonor Matilde Beatriz Carolina Mariana Inês Ana Margarida Joana Rita Catarina Sofia', last: 'Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Jesus Sousa Fernandes Gonçalves Gomes Lopes Marques Alves Almeida Ribeiro Pinto Carvalho Teixeira Moreira Correia Mendes Nunes' },
  { name: 'Polish', first: 'Jakub Antoni Jan Szymon Franciszek Filip Aleksander Mikołaj Wojciech Kacper Piotr Tomasz Zuzanna Julia Zofia Hanna Maja Lena Alicja Maria Oliwia Agnieszka Katarzyna Małgorzata Wiktoria', last: 'Nowak Kowalski Wiśniewski Wójcik Kowalczyk Kamiński Lewandowski Zieliński Szymański Woźniak Dąbrowski Kozłowski Jankowski Mazur Kwiatkowski Krawczyk Piotrowski Grabowski Nowakowski Pawłowski Michalski Nowicki Adamczyk Dudek Zając' },
  { name: 'Czech', first: 'Jakub Jan Tomáš Matyáš Adam Vojtěch Ondřej Lukáš Petr Jiří Pavel Martin Eliška Anna Tereza Adéla Natálie Karolína Kristýna Lucie Barbora Klára Veronika Markéta Zuzana', last: 'Novák Svoboda Novotný Dvořák Černý Procházka Kučera Veselý Horák Němec Marek Pokorný Pospíšil Hájek Král Jelínek Růžička Beneš Fiala Sedláček Doležal Zeman Kolář Navrátil Čermák' },
  { name: 'Slovak', first: 'Jakub Adam Samuel Michal Tomáš Lukáš Matej Martin Marek Juraj Peter Ján Sofia Nina Ema Natália Viktória Lucia Zuzana Simona Katarína Mária Jana Veronika Dominika', last: 'Horváth Kováč Varga Tóth Nagy Baláž Szabó Molnár Balog Lukáč Novák Polák Kollár Németh Oravec Hudák Šimko Kráľ Gajdoš Štefanko Rusnák Hrnčiar Mikuláš Kočiš Blaho' },
  { name: 'Hungarian', first: 'Bence Máté Levente Dominik Ádám Zalán Dániel Gergő Balázs Márton Zoltán László Hanna Anna Zoé Léna Luca Emma Boglárka Lili Réka Eszter Dóra Zsófia Katalin', last: 'Nagy Kovács Tóth Szabó Horváth Varga Kiss Molnár Németh Farkas Balogh Papp Takács Juhász Lakatos Mészáros Oláh Simon Rácz Fekete Szilágyi Török Fehér Balázs Gál', lastFirst: true },
  { name: 'Romanian', first: 'Andrei Alexandru David Luca Ștefan Mihai Ionuț Vlad Radu Matei Cristian Bogdan Maria Elena Ioana Andreea Sofia Ana Alexandra Daria Bianca Gabriela Irina Raluca Teodora', last: 'Popescu Popa Pop Radu Ionescu Dumitru Stan Stoica Gheorghe Matei Constantin Rusu Mihai Munteanu Florea Ene Dinu Marin Tudor Dobre Barbu Nistor Florescu Lungu Moldovan' },
  { name: 'Russian', first: 'Aleksandr Dmitri Maksim Ivan Artyom Mikhail Nikita Sergei Andrei Pavel Yuri Vladimir Anastasia Maria Sofia Anna Darya Polina Viktoria Yelena Olga Tatiana Natalya Irina Yekaterina', last: 'Ivanov Smirnov Kuznetsov Popov Vasilyev Petrov Sokolov Mikhailov Novikov Fyodorov Morozov Volkov Alekseyev Lebedev Semyonov Yegorov Pavlov Kozlov Stepanov Nikolayev Orlov Andreyev Makarov Zaitsev Solovyov' },
  { name: 'Ukrainian', first: 'Oleksandr Mykola Andriy Dmytro Taras Bohdan Yaroslav Ostap Vasyl Serhiy Maksym Yuriy Olena Oksana Iryna Nataliya Kateryna Sofiya Daryna Yuliya Solomiya Halyna Larysa Zoryana Viktoriya', last: 'Melnyk Shevchenko Boyko Kovalenko Bondarenko Tkachenko Kovalchuk Kravchenko Oliynyk Shevchuk Koval Polishchuk Bondar Tkachuk Marchenko Moroz Lysenko Rudenko Savchenko Petrenko Klymenko Pavlenko Kravets Kuzmenko Ponomarenko' },
  { name: 'Serbian', first: 'Luka Stefan Nikola Lazar Marko Filip Vuk Aleksa Miloš Dušan Nemanja Đorđe Sofija Milica Jovana Ana Teodora Katarina Mila Marija Jelena Tamara Dragana Ivana Vesna', last: 'Jovanović Petrović Nikolić Marković Đorđević Stojanović Ilić Stanković Pavlović Milošević Popović Đukić Kostić Lukić Tomić Ristić Savić Mitrović Vasić Obradović Simić Todorović Kovačević Vuković Radović' },
  { name: 'Croatian', first: 'Luka David Ivan Jakov Petar Marko Matej Filip Ante Josip Tomislav Domagoj Mia Lucija Ema Ana Petra Lana Marta Ivana Katarina Marija Nika Dora Klara', last: 'Horvat Kovačević Babić Marić Jurić Novak Kovačić Knežević Vuković Marković Petrović Matić Tomić Pavlović Božić Blažević Grgić Pavić Radić Perić Šarić Lovrić Vidović Perković Bošnjak' },
  { name: 'Greek', first: 'Georgios Dimitrios Konstantinos Ioannis Nikolaos Panagiotis Christos Vasileios Athanasios Evangelos Alexandros Spyridon Maria Eleni Aikaterini Vasiliki Sofia Georgia Despina Anastasia Ioanna Dimitra Paraskevi Kalliopi Zoe', last: 'Papadopoulos Papadakis Georgiou Oikonomou Vlachos Angelopoulos Nikolaidis Karagiannis Pappas Dimitriou Konstantinidis Makris Antoniou Mavros Christodoulou Ioannou Alexiou Panagiotou Kyriakou Vasileiou Stavropoulos Theodorou Galanis Lambrakis Raptis' },
  { name: 'Turkish', first: 'Yusuf Eymen Ömer Mustafa Ahmet Emir Kerem Mehmet Burak Can Emre Murat Zeynep Elif Defne Asel Ecrin Azra Ayşe Fatma Merve Selin Esra Büşra Deniz', last: 'Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara Koç Kurt Özkan Şimşek Polat Korkmaz Erdoğan Güneş Aksoy' },
  { name: 'Swedish', first: 'William Liam Noah Hugo Lucas Oliver Elias Axel Erik Lars Anders Johan Alice Maja Elsa Astrid Wilma Ebba Freja Saga Linnea Ingrid Karin Sofia Agnes', last: 'Andersson Johansson Karlsson Nilsson Eriksson Larsson Olsson Persson Svensson Gustafsson Pettersson Jonsson Jansson Hansson Bengtsson Jönsson Lindberg Lindström Lindqvist Axelsson Berg Bergström Lundberg Lundgren Sandberg' },
  { name: 'Norwegian', first: 'Jakob Emil Noah Oliver Filip William Lucas Henrik Magnus Sindre Ole Knut Nora Emma Ella Maja Olivia Ingrid Sigrid Astrid Solveig Kari Ingeborg Tuva Hedda', last: 'Hansen Johansen Olsen Larsen Andersen Pedersen Nilsen Kristiansen Jensen Karlsen Johnsen Pettersen Eriksen Berg Haugen Hagen Johannessen Andreassen Jacobsen Dahl Jørgensen Halvorsen Lund Solberg Bakken' },
  { name: 'Danish', first: 'William Noah Oscar Lucas Carl Victor Magnus Frederik Mads Rasmus Søren Anders Ida Emma Alma Clara Freja Sofie Karla Agnes Mathilde Signe Line Mette Anne', last: 'Nielsen Jensen Hansen Pedersen Andersen Christensen Larsen Sørensen Rasmussen Jørgensen Petersen Madsen Kristensen Olsen Thomsen Christiansen Poulsen Johansen Møller Mortensen Knudsen Jakobsen Mikkelsen Frederiksen Lund' },
  { name: 'Finnish', first: 'Eino Leo Väinö Elias Oliver Onni Eetu Juho Mikko Antti Matti Jukka Aino Eevi Helmi Venla Ella Siiri Aada Lilja Hanna Johanna Kaisa Liisa Tuula', last: 'Korhonen Virtanen Mäkinen Nieminen Mäkelä Hämäläinen Laine Heikkinen Koskinen Järvinen Lehtonen Lehtinen Saarinen Salminen Heinonen Niemi Heikkilä Kinnunen Salonen Turunen Salo Laitinen Tuominen Rantanen Karjalainen' },
  { name: 'Icelandic', first: 'Jón Sigurður Guðmundur Gunnar Ólafur Einar Kristján Magnús Stefán Aron Ari Björn Guðrún Anna Sigríður Kristín Margrét Helga Sigrún Ingibjörg Katrín Freyja Hildur Ásdís Embla', last: 'Jónsson Sigurðsson Guðmundsson Gunnarsson Ólafsson Einarsson Kristjánsson Magnússon Stefánsson Björnsson Jónsdóttir Sigurðardóttir Guðmundsdóttir Gunnarsdóttir Ólafsdóttir Einarsdóttir Kristjánsdóttir Magnúsdóttir Stefánsdóttir Björnsdóttir' },
  { name: 'Estonian', first: 'Rasmus Robin Oliver Sebastian Martin Mattias Kristjan Karl Jaan Andres Toomas Mart Sofia Eliise Mia Maria Laura Mirtel Liisa Kertu Kadri Triin Maarja Pille Katrin', last: 'Tamm Saar Sepp Mägi Kask Kukk Rebane Ilves Pärn Koppel Kuusk Karu Lepik Oja Kõiv Lõhmus Raudsepp Vaher Kallas Luik Lepp Teder Kivi Laur Mets' },
  { name: 'Lithuanian', first: 'Jonas Lukas Matas Dominykas Nojus Kajus Mantas Tomas Darius Andrius Vytautas Mindaugas Sofija Emilija Gabija Lėja Austėja Kamilė Ieva Rūta Agnė Eglė Milda Jurgita Laura', last: 'Kazlauskas Jankauskas Petrauskas Stankevičius Vasiliauskas Žukauskas Butkus Paulauskas Urbonas Kavaliauskas Navickas Ramanauskas Savickas Rimkus Baranauskas Žilinskas Šimkus Bartkus Ivanauskas Mockus Adomaitis Vaitkus Lukoševičius Kairys Kaminskas' },
  { name: 'Japanese', first: 'Haruto Ren Sota Yuto Hinata Riku Kaito Takumi Hiroshi Kenji Daiki Shota Yui Himari Sakura Aoi Hina Yuna Mei Rin Yuki Haruka Misaki Ayaka Emi', last: 'Satō Suzuki Takahashi Tanaka Watanabe Itō Yamamoto Nakamura Kobayashi Katō Yoshida Yamada Sasaki Yamaguchi Matsumoto Inoue Kimura Hayashi Shimizu Yamazaki Mori Abe Ikeda Hashimoto Ishikawa', lastFirst: true },
  { name: 'Chinese', first: 'Wei Hao Jun Ming Lei Jie Tao Yang Chen Bo Hui Kang Fang Ling Xiu Mei Lan Jing Yan Na Xin Yu Hua Qing Rui', last: 'Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Gao Lin Luo Zheng Liang Xie Song Tang', lastFirst: true },
  { name: 'Korean', first: 'Min-jun Seo-jun Do-yun Ye-jun Si-woo Ha-jun Ji-ho Joon-ho Hyun-woo Tae-yang Seo-yeon Ji-woo Ha-eun Seo-yun Min-seo Ji-yoo Su-a Ji-min Yoo-na Da-eun Eun-ji Hye-jin', last: 'Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song Jeon Hong Yoo Ko Moon Yang Baek', lastFirst: true },
  { name: 'Vietnamese', first: 'Minh Anh Huy Khang Bảo Phúc Quân Đức Long Tuấn Hùng Nam Linh Trang Ngọc Hương Mai Lan Thảo Hà Vy Nhi Thu Hạnh Phương', last: 'Nguyễn Trần Lê Phạm Hoàng Huỳnh Phan Vũ Võ Đặng Bùi Đỗ Hồ Ngô Dương Lý Đinh Trương Mai Lâm Tô Hà Đoàn Cao Lương', lastFirst: true },
  { name: 'Thai', first: 'Somchai Somsak Anan Kittisak Thanakorn Prasert Wichai Chaiwat Nattapong Sombat Arthit Kiet Siriporn Somying Malee Nok Pim Ploy Kanya Ratana Suda Wanida Anong Chanya Lamai', last: 'Saetang Srisuk Sukjai Wongsa Chaiyaporn Rattanakorn Thongchai Boonmee Kaewkla Phromma Somboon Chaiyasit Sirichai Pattana Thongdee Saelim Jaidee Kongkaew Suwan Inthasorn' },
  { name: 'Indian (Hindi)', first: 'Aarav Vivaan Aditya Vihaan Arjun Sai Reyansh Ayaan Krishna Ishaan Rohan Rahul Ananya Diya Saanvi Aadhya Pari Anika Navya Myra Priya Kavya Riya Pooja Neha', last: 'Sharma Verma Gupta Singh Kumar Patel Mehta Joshi Agarwal Mishra Yadav Chauhan Pandey Reddy Nair Iyer Rao Kapoor Malhotra Bose Das Banerjee Chatterjee Desai Shah' },
  { name: 'Arabic', first: 'Mohammed Ahmed Ali Omar Youssef Khalid Hassan Ibrahim Karim Tariq Hamza Faisal Fatima Aisha Maryam Layla Noor Zainab Huda Salma Rania Yasmin Amira Leila Hana', last: 'Al-Sayed Haddad Khoury Mansour Nasser Saleh Hamdan Darwish Najjar Aziz Rahman Farouk Qasim Habib Suleiman Hussein Abboud Bakr Jaber Kassab Sabbagh Tamimi Zayed Karam Shaheen' },
  { name: 'Persian', first: 'Amir Ali Reza Mehdi Hossein Arash Dariush Kian Kourosh Babak Farhad Navid Shirin Leila Maryam Parisa Roya Nazanin Ladan Mahsa Niloufar Setareh Golnar Yasaman Azadeh', last: 'Hosseini Ahmadi Mohammadi Rezaei Moradi Karimi Jafari Rahimi Kazemi Ghasemi Hashemi Sadeghi Bagheri Mousavi Tehrani Shirazi Esfahani Rostami Farahani Kamali Najafi Akbari Soltani Zand Amini' },
  { name: 'Hebrew', first: 'David Yosef Ariel Noam Itai Eitan Uri Yonatan Lavi Amit Omer Gilad Noa Tamar Maya Yael Shira Avigail Michal Talia Hila Rivka Adi Liat Neta', last: 'Cohen Levi Mizrahi Peretz Biton Dahan Avraham Friedman Malka Azoulay Katz Yosef David Amar Ohana Hadad Gabay Ben-David Shapiro Kaplan Rosen Weiss Goldberg Segal Adler' },
  { name: 'Swahili', first: 'Juma Baraka Jabari Kamau Mosi Rashidi Hamisi Bakari Daudi Faraji Hasani Jelani Amani Zawadi Neema Imani Rehema Asha Halima Mwajuma Zuhura Saida Furaha Upendo Nia', last: 'Mwangi Otieno Kamau Ochieng Wanjiru Mwakasege Juma Hassan Kariuki Njoroge Mutua Kimani Omondi Mohamed Odhiambo Wekesa Kiprono Nyambura Achieng Mbwana Salim Mrisho Chande Massawe Lyimo' },
  { name: 'Yoruba', first: 'Ayodele Babatunde Femi Olumide Tunde Adewale Kayode Segun Oluwaseun Dayo Gbenga Ade Funmilayo Folake Yetunde Bisola Titilayo Abimbola Adeola Ronke Simisola Temitope Ifeoma Morenike Ayomide', last: 'Adeyemi Adebayo Ogunleye Olawale Oyelaran Afolabi Akinola Balogun Bankole Oladipo Adesanya Okonkwo Adewale Ogundipe Ajayi Alabi Fashola Ogunbanjo Adeleke Oyewole Akande Olaniyan Odunsi Adekunle Oyinlola' },
  { name: 'Zulu', first: 'Sipho Thabo Mandla Bongani Sibusiso Themba Lwazi Siyabonga Nkosinathi Mthunzi Langa Andile Thandiwe Nomvula Zanele Lindiwe Nandi Ayanda Sibongile Nokuthula Zodwa Thandeka Busisiwe Hlengiwe Nosipho', last: 'Dlamini Nkosi Ndlovu Khumalo Mthembu Zulu Mkhize Ngcobo Buthelezi Shabalala Zungu Mahlangu Cele Gumede Mabaso Nxumalo Ntuli Sithole Mazibuko Hadebe Mbatha Msimang Radebe Madlala Majola' },
  { name: 'Hawaiian', first: 'Kai Keoni Makoa Kale Ikaika Koa Nalu Kekoa Palani Mana Kainoa Keahi Leilani Kalena Malia Noelani Kailani Moana Iolana Hōkū Pua Kaimana Nohea Alana Mahina', last: 'Kahale Kealoha Kanoho Kamakana Kaleo Akana Kahananui Keawe Kalani Makoa Palakiko Nakamura Kaʻiliwai Mahoe Kekona Kauhane Kaupu Akina Kahue Nāone' },
  { name: 'Māori', first: 'Nikau Tama Wiremu Rawiri Hemi Tane Manaia Ari Kahu Rangi Matiu Tipene Aroha Kiri Mere Moana Ngaio Ataahua Hine Marama Huia Kaia Wairua Anahera Mihi', last: 'Ngata Walker Parata Tamihana Rewi Wihongi Paki Tipene Rangi Kereama Pomare Hohepa Ruatapu Taiaroa Horomona Waaka Te Rangi Te Whare Tuhiwai Manuera' },
]

/** Next-letter counts after each pair of letters, from a list of names. */
function chain(words: string[]) {
  const next = new Map<string, string[]>()
  for (const w of words) {
    const s = `^^${w.toLowerCase()}$`
    for (let i = 2; i < s.length; i++) {
      const k = s.slice(i - 2, i)
      let list = next.get(k)
      if (!list) next.set(k, (list = []))
      list.push(s[i])
    }
  }
  return next
}

const capitalize = (w: string) => w.replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())

/** A name that sounds like `words` but is not one of them (null when the list is too small to vary). */
export function inventName(words: string[], random: () => number): string | null {
  const next = chain(words)
  const known = new Set(words.map((w) => w.toLowerCase()))
  for (let attempt = 0; attempt < 40; attempt++) {
    let s = '^^'
    while (s.length < 16) {
      const opts = next.get(s.slice(-2))
      if (!opts) break
      const c = opts[Math.floor(random() * opts.length)]
      if (c === '$') break
      s += c
    }
    const w = s.slice(2)
    if (w.length >= 3 && !known.has(w)) return capitalize(w)
  }
  return null
}

/** Family names; lowercase particles ("de Jong", "van den Berg") stay with the name after them. */
export function familyNames(style: NameStyle): string[] {
  const out: string[] = []
  let lead = ''
  for (const t of style.last.split(' ')) {
    if (/^\p{Ll}/u.test(t)) lead += `${t} `
    else {
      out.push(lead + t)
      lead = ''
    }
  }
  return out
}

/** `count` full names in a style: real first and family names mixed, or new ones that sound like them. */
export function styleNames(style: NameStyle, count: number, invent: boolean, random: () => number): string[] {
  const firsts = style.first.split(' ')
  const lasts = familyNames(style)
  const pick = (a: string[]) => a[Math.floor(random() * a.length)]
  const out = new Set<string>()
  for (let i = 0; i < count * 4 && out.size < count; i++) {
    const f = invent ? (inventName(firsts, random) ?? pick(firsts)) : pick(firsts)
    const l = invent && random() < 0.5 ? (inventName(lasts, random) ?? pick(lasts)) : pick(lasts)
    out.add(style.lastFirst ? `${l} ${f}` : `${f} ${l}`)
  }
  return [...out]
}
